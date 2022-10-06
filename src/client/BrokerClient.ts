import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import * as logger from '../logger';
import { BrokerMessage } from '../domain/BrokerMessage';
import { BrokerEnvelope, BrokerPayload } from '../domain/BrokerEnvelope';

const CONNECTION_NAME_HEADER_NAME = 'x-api-key';
const BROKER_CONNECT_TIMEOUT = 3000;
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
    private connected: boolean;
    private messageMap: Map<string, InFlightMessage>;
    private connectPromise: Promise<undefined> | undefined;

    constructor(brokerURL: string, connectionName: string) {
        this.brokerURL = this._normalizeBrokerUrl(brokerURL);
        this.connectionName = connectionName;
        this.connected = false;
        this.messageMap = new Map<string, InFlightMessage>();
    }

    _normalizeBrokerUrl(url: string): string {
        if (url.startsWith('ws://') || url.startsWith('wss://')) {
            return url;
        } else {
            return 'wss://' + url;
        }
    }

    _destroyInFlightMessages(code: number, reason: string | Buffer) {
        for (let [msgId, inFlightMessage] of this.messageMap.entries()) {
            inFlightMessage.resolve(
                new Error(
                    `Connection is closed (code=${code}, reason=${reason}`
                )
            );
            this.messageMap.delete(msgId);
        }
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
                [CONNECTION_NAME_HEADER_NAME]: this.connectionName,
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
            if (message && message.responseOf) {
                const inFlightMessage = this.messageMap.get(message.responseOf);
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
            this._destroyInFlightMessages(-1, err.message);
        });
        this.brokerSocket.on('close', (code: number, reason: Buffer) => {
            logger.debug(
                `Closed connection to broker at ${this.brokerURL}: code=${code}, reason=${reason}`
            );

            this.connected = false;
            this.connectPromise = undefined;
            this.brokerSocket = null;
            this._destroyInFlightMessages(code, reason);
        });

        return this.connectPromise;
    }

    async ensureConnected() {
        if (this.connected) {
            return;
        }
        if (this.connectPromise) {
            await this.connectPromise;
        } else {
            throw new Error(`Not connected to broker at ${this.brokerURL}`);
        }
    }

    _doReceive(data: string): BrokerMessage | undefined {
        const brokerEnvelope: BrokerEnvelope = JSON.parse(data);
        if (!brokerEnvelope || !brokerEnvelope.payload) {
            logger.error('Empty broker payload received');
            return;
        }

        // TODO Handle fragmentation for big messages

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

    async _doSend(msg: BrokerMessage, cb: (err?: Error) => void) {
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
