import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as logger from '../logger';
import { BrokerMessage } from '../domain/BrokerMessage';
import { BrokerEnvelope, BrokerPayload } from '../domain/BrokerEnvelope';

const CONNECTION_TYPE_SEPARATOR = '::';
const CONNECTION_API_KEY_SEPARATOR = '##';
const CONNECTION_NAME_HEADER_NAME = 'x-api-key';
const GATEKEEPER_CONNECTION_NAME_PREFIX = `gatekeeper${CONNECTION_TYPE_SEPARATOR}`;
const CLIENT_DISCONNECT_MESSAGE_TYPE = 'client.disconnect';
const WEBSOCKET_NORMAL_CLOSE_CODE = 1000;
const BROKER_CONNECT_TIMEOUT = 3000;
const BROKER_PING_TIMEOUT = 3000;
const MAX_FRAME_SIZE = 16 * 1024;

type InFlightMessage = {
    readonly msg: any;
    readonly resolve: Function;
    readonly reject: Function;
    readonly timeout?: NodeJS.Timeout;
};

export default class BrokerClient {
    private brokerSocket: WebSocket | null;
    private brokerURL: string;
    private connectionName: string;
    private apiKey?: string;
    private connected: boolean;
    private messageMap: Map<string, InFlightMessage>;
    private connectPromise: Promise<undefined> | undefined;
    private fragmentedMessages: Map<string, Map<number, BrokerEnvelope>>;

    constructor(brokerURL: string, connectionName: string, apiKey?: string) {
        this.brokerURL = this._normalizeBrokerUrl(brokerURL);
        this.connectionName = connectionName;
        this.apiKey = apiKey;
        this.connected = false;
        this.messageMap = new Map<string, InFlightMessage>();
        this.fragmentedMessages = new Map<
            string,
            Map<number, BrokerEnvelope>
        >();
    }

    private _normalizeBrokerUrl(url: string): string {
        if (url.startsWith('ws://') || url.startsWith('wss://')) {
            return url;
        } else {
            return 'wss://' + url;
        }
    }

    private _clearState(code: number, reason: string | Buffer) {
        for (let [msgId, inFlightMessage] of this.messageMap.entries()) {
            inFlightMessage.reject(
                new Error(
                    `Connection is closed (code=${code}, reason=${reason}`
                )
            );
            this.messageMap.delete(msgId);
        }
        this.fragmentedMessages.clear();
    }

    getFullConnectionName(): string {
        return this.apiKey
            ? `${this.connectionName}${CONNECTION_API_KEY_SEPARATOR}${this.apiKey}`
            : this.connectionName;
    }

    async connect(timeoutDuration: number = BROKER_CONNECT_TIMEOUT) {
        if (this.connected) {
            logger.debug(
                `Already connected to broker at ${this.brokerURL}: connection name=${this.connectionName}`
            );
            return Promise.resolve();
        }

        if (this.connectPromise) {
            return this.connectPromise;
        }

        let connectRes: Function;
        let connectRej: Function;
        this.connectPromise = new Promise((res: Function, rej: Function) => {
            connectRes = res;
            connectRej = rej;
        });

        logger.debug(
            `Connecting to broker at ${this.brokerURL}: connection name=${this.connectionName} ...`
        );

        this.brokerSocket = new WebSocket(this.brokerURL, {
            headers: {
                [CONNECTION_NAME_HEADER_NAME]: `${GATEKEEPER_CONNECTION_NAME_PREFIX}${this.getFullConnectionName()}`,
            },
            handshakeTimeout: timeoutDuration,
            followRedirects: true,
        });

        this.brokerSocket.on('open', () => {
            logger.debug(`Connected to broker at ${this.brokerURL}`);

            this.connected = true;
            this.connectPromise = undefined;
            if (connectRes) {
                connectRes();
            }
        });
        this.brokerSocket.on('message', (data) => {
            if (logger.isDebugEnabled()) {
                logger.debug(`Received message from broker: ${data}`);
            }

            const message: BrokerMessage | undefined = this._doReceive(
                data.toString()
            );
            if (message) {
                if (message.type === CLIENT_DISCONNECT_MESSAGE_TYPE) {
                    logger.debug(
                        'Client disconnected, so closing broker client.'
                    );
                    this.close(
                        WEBSOCKET_NORMAL_CLOSE_CODE,
                        'Client disconnected, so closing broker client.'
                    );
                } else if (message.responseOf) {
                    const inFlightMessage = this.messageMap.get(
                        message.responseOf
                    );
                    if (inFlightMessage) {
                        this.messageMap.delete(message.id);
                        if (inFlightMessage.resolve) {
                            inFlightMessage.resolve(message);
                        }
                        if (inFlightMessage.timeout) {
                            clearTimeout(inFlightMessage.timeout);
                        }
                    }
                }
            }
        });
        this.brokerSocket.on('pong', (data) => {
            logger.debug(`Received pong message from broker`);
        });
        this.brokerSocket.on('error', (err) => {
            logger.debug(
                `Error from broker connection at ${this.brokerURL}`,
                err
            );

            if (!this.connected && connectRej) {
                logger.debug(
                    `Broker connection rejected at ${this.brokerURL}`,
                    err
                );
                connectRej(err);
            }
            this.connected = false;
            this.connectPromise = undefined;
            this.brokerSocket = null;
            this._clearState(-1, err.message);
        });
        this.brokerSocket.on('close', (code: number, reason: Buffer) => {
            logger.debug(
                `Closed connection to broker at ${this.brokerURL}: code=${code}, reason=${reason}`
            );

            this.connected = false;
            this.connectPromise = undefined;
            this.brokerSocket = null;
            this._clearState(code, reason);
        });

        return this.connectPromise;
    }

    private async _sendPing(): Promise<boolean> {
        return new Promise((resolve: Function, reject: Function) => {
            let timeout: NodeJS.Timeout = setTimeout(() => {
                logger.debug(
                    `Timeout while sending to broker after ${BROKER_PING_TIMEOUT} milliseconds`
                );
                resolve(false);
            });
            try {
                logger.debug(`Sending ping to broker ...`);
                this.brokerSocket?.ping((err?: Error) => {
                    try {
                        if (err) {
                            resolve(false);
                        } else {
                            resolve(true);
                        }
                    } finally {
                        clearTimeout(timeout);
                    }
                });
            } catch (err: any) {
                logger.debug(
                    `Error occurred while sending ping to broker`,
                    err
                );
                resolve(false);
            }
        });
    }

    async checkConnected(): Promise<boolean> {
        if (this.connected) {
            return await this._sendPing();
        }
        if (this.connectPromise) {
            await this.connectPromise;
            return await this._sendPing();
        } else {
            return false;
        }
    }

    async recreateAndConnect(): Promise<BrokerClient | undefined> {
        logger.debug('Recreating broker client and connecting to broker ...');
        return new Promise<BrokerClient | undefined>((res, rej) => {
            logger.debug('Creating broker client ...');
            const client: BrokerClient = new BrokerClient(
                this.brokerURL,
                this.connectionName,
                this.apiKey
            );
            logger.debug('Created broker client');
            client
                .connect()
                .then(() => {
                    logger.debug('Connected to broker');
                    res(client);
                })
                .catch((err: Error) => {
                    logger.error('Unable to connect to broker', err);
                    res(undefined);
                });
        });
    }

    async reset() {
        this._clearState(0, 'Reset');
    }

    private _doReceive(data: string): BrokerMessage | undefined {
        let brokerEnvelope: BrokerEnvelope = JSON.parse(data);
        if (!brokerEnvelope || !brokerEnvelope.payload) {
            logger.error('Empty broker payload received');
            return;
        }

        if (brokerEnvelope.fragmented) {
            const fragmentCount: number = brokerEnvelope.fragmentCount!;
            let fragmentedEnvelopes: Map<number, BrokerEnvelope> | undefined =
                this.fragmentedMessages.get(brokerEnvelope.id);
            if (!fragmentedEnvelopes) {
                fragmentedEnvelopes = new Map<number, BrokerEnvelope>();
                this.fragmentedMessages.set(
                    brokerEnvelope.id,
                    fragmentedEnvelopes
                );
            }
            fragmentedEnvelopes.set(brokerEnvelope.fragmentNo!, brokerEnvelope);
            if (logger.isDebugEnabled()) {
                logger.debug(
                    `Buffering fragmented message (fragment=${brokerEnvelope.fragmentNo}): ${brokerEnvelope.payload} ...`
                );
            }
            if (fragmentedEnvelopes.size >= fragmentCount) {
                // Sort fragments by fragment orders
                const sortedFragmentedEnvelopes: Map<number, BrokerEnvelope> =
                    new Map(
                        [...fragmentedEnvelopes].sort(
                            (
                                a: [number, BrokerEnvelope],
                                b: [number, BrokerEnvelope]
                            ) => a[0] - b[0]
                        )
                    );
                let stickedPayload: string = '';
                // Stick fragmented payloads
                for (let envelope of sortedFragmentedEnvelopes.values()) {
                    if (logger.isDebugEnabled()) {
                        logger.debug(
                            `Sticking fragmented message (fragment=${envelope.fragmentNo}): ${envelope.payload} ...`
                        );
                    }
                    stickedPayload = stickedPayload.concat(envelope.payload);
                }
                brokerEnvelope.payload = stickedPayload;
            } else {
                // Not received all fragments, don't process this envelope now.
                // Because the merged envelope will be processed later once all the fragments are received.
                return undefined;
            }
        }

        const brokerPayload: BrokerPayload = JSON.parse(brokerEnvelope.payload);
        if (!brokerPayload) {
            logger.error('Empty broker payload received');
            return;
        }

        return {
            id: brokerEnvelope.id,
            responseOf: brokerEnvelope.responseOf,
            connectionName: brokerEnvelope.connectionName,
            sourceConnectionId: brokerEnvelope.sourceConnectionId,
            sourceConnectionType: brokerEnvelope.sourceConnectionType,
            targetConnectionId: brokerEnvelope.targetConnectionId,
            targetConnectionType: brokerEnvelope.targetConnectionType,
            type: brokerEnvelope.type,
            data: brokerPayload.data,
            error: brokerPayload.error,
        } as BrokerMessage;
    }

    private async _doSend(msg: BrokerMessage, cb: (err?: Error) => void) {
        const brokerPayload: BrokerPayload = {
            data: msg.data,
            error: msg.error,
        };
        const brokerPayloadJson: string = JSON.stringify(brokerPayload);

        if (brokerPayloadJson.length <= MAX_FRAME_SIZE) {
            const brokerEnvelope: BrokerEnvelope = {
                id: msg.id,
                responseOf: msg.responseOf,
                connectionName: msg.connectionName,
                sourceConnectionId: msg.sourceConnectionId,
                sourceConnectionType: msg.sourceConnectionType,
                targetConnectionId: msg.targetConnectionId,
                targetConnectionType: msg.targetConnectionType,
                type: msg.type,
                payload: brokerPayloadJson,
                fragmented: false,
                fragmentCount: -1,
                fragmentNo: -1,
            };
            const brokerEnvelopeJson: string = JSON.stringify(brokerEnvelope);

            if (logger.isDebugEnabled()) {
                logger.debug(
                    `Sending message to broker: ${brokerEnvelopeJson}`
                );
            }

            this.brokerSocket?.send(brokerEnvelopeJson, cb);
        } else {
            const fragmentCount: number = Math.ceil(
                brokerPayloadJson.length / MAX_FRAME_SIZE
            );
            for (let i = 0; i < fragmentCount; i++) {
                const fragmentedPayload: string = brokerPayloadJson.substring(
                    i * MAX_FRAME_SIZE,
                    Math.min((i + 1) * MAX_FRAME_SIZE, brokerPayloadJson.length)
                );
                const brokerEnvelope: BrokerEnvelope = {
                    id: msg.id,
                    responseOf: msg.responseOf,
                    connectionName: msg.connectionName,
                    sourceConnectionId: msg.sourceConnectionId,
                    sourceConnectionType: msg.sourceConnectionType,
                    targetConnectionId: msg.targetConnectionId,
                    targetConnectionType: msg.targetConnectionType,
                    type: msg.type,
                    payload: fragmentedPayload,
                    fragmented: true,
                    fragmentNo: i,
                    fragmentCount,
                };
                const brokerEnvelopeJson: string =
                    JSON.stringify(brokerEnvelope);

                if (logger.isDebugEnabled()) {
                    logger.debug(
                        `Sending message (fragment: ${i}) to broker: ${brokerEnvelopeJson}`
                    );
                }

                this.brokerSocket?.send(brokerEnvelopeJson, cb);
            }
        }
    }

    async send(
        msg: BrokerMessage,
        timeoutDuration: number = -1
    ): Promise<undefined> {
        if (!msg.id) {
            msg.id = uuidv4();
        }
        return new Promise((resolve: Function, reject: Function) => {
            if (!this.connected) {
                reject('Not connected');
                return;
            }
            if (this.brokerSocket?.readyState === WebSocket.OPEN) {
                let timeout: NodeJS.Timeout | undefined;
                if (timeoutDuration > 0) {
                    timeout = setTimeout(() => {
                        reject(
                            new Error(
                                `Timeout after ${timeoutDuration} milliseconds`
                            )
                        );
                    }, timeoutDuration);
                }
                try {
                    this._doSend(msg, (err?: Error) => {
                        try {
                            if (err) {
                                return reject(err);
                            }
                            resolve();
                        } finally {
                            if (timeout) {
                                clearTimeout(timeout);
                            }
                        }
                    });
                } catch (err: any) {
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    throw err;
                }
            } else {
                reject('Not ready');
            }
        });
    }

    async sendAndGetResponse(
        msg: BrokerMessage,
        timeoutDuration: number = -1
    ): Promise<BrokerMessage> {
        if (!msg.id) {
            msg.id = uuidv4();
        }
        return new Promise((resolve, reject) => {
            if (!this.connected) {
                reject('Not connected');
                return;
            }
            if (this.brokerSocket?.readyState === WebSocket.OPEN) {
                let timeout: NodeJS.Timeout | undefined;
                if (timeoutDuration > 0) {
                    timeout = setTimeout(() => {
                        reject(
                            new Error(`Timeout after ${timeout} milliseconds`)
                        );
                    }, timeoutDuration);
                }
                try {
                    this._doSend(msg, (err?: Error) => {
                        if (err) {
                            return reject(err);
                        }
                        this.messageMap.set(msg.id, {
                            msg,
                            resolve,
                            reject,
                            timeout,
                        });
                    });
                } catch (err: any) {
                    if (timeout) {
                        clearTimeout(timeout);
                    }
                    throw err;
                }
            } else {
                reject('Not ready');
            }
        });
    }

    close(code: number, reason: string) {
        if (!this.connected) {
            return;
        }
        this.connected = false;
        if (this.brokerSocket?.readyState == WebSocket.OPEN) {
            this.brokerSocket?.close(code, reason);
            this.brokerSocket = null;
        }
    }
}
