import ExtensionClient from './client/ExtensionClient';
import * as logger from './logger';
import axios, { AxiosResponse, AxiosResponseHeaders } from 'axios';
import BrokerClient from './client/BrokerClient';
import { BrokerMessage } from './domain/BrokerMessage';
import {
    NEXT_INVOCATION_PATH,
    REQUEST_ID_PATH_PARAM,
    INVOCATION_RESPONSE_PATH,
    INVOCATION_ERROR_PATH,
} from './constants';
import { v4 as uuidv4 } from 'uuid';
import Queue from './utils/Queue';

const LAMBDA_RUNTIME_AWS_REQUEST_ID_HEADER_NAME =
    'lambda-runtime-aws-request-id';
const LAMBDA_RUNTIME_INVOKED_FUNCTION_ARN_HEADER_NAME =
    'lambda-runtime-invoked-function-arn';
const LAMBDA_RUNTIME_DEADLINE_MS_HEADER_NAME = 'lambda-runtime-deadline-ms';
const LAMBDA_RUNTIME_TRACE_ID_HEADER_NAME = 'lambda-runtime-trace-id';
const LAMBDA_RUNTIME_CLIENT_CONTEXT_HEADER_NAME =
    'lambda-runtime-client-context';
const LAMBDA_RUNTIME_COGNITO_IDENTITY_HEADER_NAME =
    'lambda-runtime-cognito-identity';

const MERLOC_LAMBDA_HANDLER_ENV_VAR_NAME = 'MERLOC_AWS_LAMBDA_HANDLER';
const AWS_REGION_ENV_VAR_NAME = 'AWS_REGION';
const AWS_LAMBDA_FUNCTION_NAME_ENV_VAR_NAME = 'AWS_LAMBDA_FUNCTION_NAME';
const AWS_LAMBDA_FUNCTION_VERSION_ENV_VAR_NAME = 'AWS_LAMBDA_FUNCTION_VERSION';
const AWS_EXECUTION_ENV_ENV_VAR_NAME = 'AWS_EXECUTION_ENV';
const AWS_LAMBDA_FUNCTION_MEMORY_SIZE_ENV_VAR_NAME =
    'AWS_LAMBDA_FUNCTION_MEMORY_SIZE';
const AWS_LAMBDA_LOG_GROUP_NAME_ENV_VAR_NAME = 'AWS_LAMBDA_LOG_GROUP_NAME';
const AWS_LAMBDA_LOG_STREAM_NAME_ENV_VAR_NAME = 'AWS_LAMBDA_LOG_STREAM_NAME';
const AWS_LAMBDA_TRACE_ID_ENV_VAR_NAME = '_X_AMZN_TRACE_ID';

const AWS_LAMBDA_REGION_ATTRIBUTE_NAME = 'region';
const AWS_LAMBDA_REQUEST_ID_ATTRIBUTE_NAME = 'requestId';
const AWS_LAMBDA_HANDLER_ATTRIBUTE_NAME = 'handler';
const AWS_LAMBDA_FUNCTION_ARN_ATTRIBUTE_NAME = 'functionArn';
const AWS_LAMBDA_FUNCTION_NAME_ATTRIBUTE_NAME = 'functionName';
const AWS_LAMBDA_FUNCTION_VERSION_ATTRIBUTE_NAME = 'functionVersion';
const AWS_LAMBDA_RUNTIME_ATTRIBUTE_NAME = 'runtime';
const AWS_LAMBDA_TIMEOUT_ATTRIBUTE_NAME = 'timeout';
const AWS_LAMBDA_MEMORY_SIZE_ATTRIBUTE_NAME = 'memorySize';
const AWS_LAMBDA_LOG_GROUP_NAME_ATTRIBUTE_NAME = 'logGroupName';
const AWS_LAMBDA_LOG_STREAM_NAME_ATTRIBUTE_NAME = 'logStreamName';
const AWS_LAMBDA_ENV_VARS_ATTRIBUTE_NAME = 'envVars';
const AWS_LAMBDA_CLIENT_CONTEXT_ATTRIBUTE_NAME = 'clientContext';
const AWS_LAMBDA_COGNITO_IDENTITY_ATTRIBUTE_NAME = 'cognitoIdentity';
const AWS_LAMBDA_REQUEST_ATTRIBUTE_NAME = 'request';

const CLIENT_CONNECTION_TYPE = 'client';
const GATEKEEPER_CONNECTION_TYPE = 'gatekeeper';
const CLIENT_REQUEST_MESSAGE_TYPE = 'client.request';

export type InvocationRequest = {
    data: any;
    status: number;
    headers: Record<string, string>;
};

export default class Runtime {
    private extensionClient: ExtensionClient;
    private brokerClient: BrokerClient;
    private invocationRequestQueue: Queue<InvocationRequest>;

    constructor(extensionClient: ExtensionClient, brokerClient: BrokerClient) {
        this.extensionClient = extensionClient;
        this.brokerClient = brokerClient;
        this.invocationRequestQueue = new Queue<any>();
    }

    private _createClientRequest(
        connectionName: string,
        headers: AxiosResponseHeaders,
        request: any
    ): BrokerMessage {
        //
        const data: any = {
            [AWS_LAMBDA_REGION_ATTRIBUTE_NAME]:
                process.env[AWS_REGION_ENV_VAR_NAME],
            [AWS_LAMBDA_REQUEST_ID_ATTRIBUTE_NAME]:
                headers[LAMBDA_RUNTIME_AWS_REQUEST_ID_HEADER_NAME],
            [AWS_LAMBDA_HANDLER_ATTRIBUTE_NAME]:
                this.extensionClient.getHandler(),
            [AWS_LAMBDA_FUNCTION_ARN_ATTRIBUTE_NAME]:
                headers[LAMBDA_RUNTIME_INVOKED_FUNCTION_ARN_HEADER_NAME],
            [AWS_LAMBDA_FUNCTION_NAME_ATTRIBUTE_NAME]:
                process.env[AWS_LAMBDA_FUNCTION_NAME_ENV_VAR_NAME],
            [AWS_LAMBDA_FUNCTION_VERSION_ATTRIBUTE_NAME]:
                process.env[AWS_LAMBDA_FUNCTION_VERSION_ENV_VAR_NAME],
            [AWS_LAMBDA_RUNTIME_ATTRIBUTE_NAME]:
                process.env[AWS_EXECUTION_ENV_ENV_VAR_NAME] || 'merloc',
            [AWS_LAMBDA_TIMEOUT_ATTRIBUTE_NAME]:
                parseInt(headers[LAMBDA_RUNTIME_DEADLINE_MS_HEADER_NAME]) -
                Date.now(),
            [AWS_LAMBDA_MEMORY_SIZE_ATTRIBUTE_NAME]: parseInt(
                process.env[AWS_LAMBDA_FUNCTION_MEMORY_SIZE_ENV_VAR_NAME] ||
                    '-1'
            ),
            [AWS_LAMBDA_LOG_GROUP_NAME_ATTRIBUTE_NAME]:
                process.env[AWS_LAMBDA_LOG_GROUP_NAME_ENV_VAR_NAME],
            [AWS_LAMBDA_LOG_STREAM_NAME_ATTRIBUTE_NAME]:
                process.env[AWS_LAMBDA_LOG_STREAM_NAME_ENV_VAR_NAME],
            [AWS_LAMBDA_CLIENT_CONTEXT_ATTRIBUTE_NAME]:
                headers[LAMBDA_RUNTIME_CLIENT_CONTEXT_HEADER_NAME],
            [AWS_LAMBDA_COGNITO_IDENTITY_ATTRIBUTE_NAME]:
                headers[LAMBDA_RUNTIME_COGNITO_IDENTITY_HEADER_NAME],
            [AWS_LAMBDA_ENV_VARS_ATTRIBUTE_NAME]: Object.assign(
                {
                    [AWS_LAMBDA_TRACE_ID_ENV_VAR_NAME]:
                        headers[LAMBDA_RUNTIME_TRACE_ID_HEADER_NAME],
                    [MERLOC_LAMBDA_HANDLER_ENV_VAR_NAME]:
                        process.env[MERLOC_LAMBDA_HANDLER_ENV_VAR_NAME],
                },
                process.env
            ),
            [AWS_LAMBDA_REQUEST_ATTRIBUTE_NAME]: JSON.stringify(request),
        };
        return {
            id: uuidv4(),
            type: CLIENT_REQUEST_MESSAGE_TYPE,
            connectionName,
            sourceConnectionType: GATEKEEPER_CONNECTION_TYPE,
            targetConnectionType: CLIENT_CONNECTION_TYPE,
            data,
        };
    }

    async handleCurrentInvocation() {
        try {
            const nextInvocationURL = `http://${process.env.AWS_LAMBDA_RUNTIME_API}${NEXT_INVOCATION_PATH}`;

            if (logger.isDebugEnabled()) {
                logger.debug(
                    `Getting next invocation request from real AWS Lambda runtime API at ${nextInvocationURL} ...`
                );
            }

            // Get next invocation request from real AWS Lambda runtime API
            const nextInvocationResp: AxiosResponse = await axios.get(
                nextInvocationURL
            );

            if (logger.isDebugEnabled()) {
                logger.debug(
                    `Got next invocation request from real AWS Lambda runtime API at ${nextInvocationURL}: ` +
                        `${logger.toJson(nextInvocationResp)}`
                );
            }

            let forwardToRealLambdaRuntime = true;

            try {
                let connected = await this.brokerClient.checkConnected();
                logger.debug(`Broker client connected: ${connected}`);
                if (!connected) {
                    logger.debug(
                        'Broker client disconnected, so creating new fresh broker client ...'
                    );
                    const newBrokerClient: BrokerClient | undefined =
                        await this.brokerClient.recreateAndConnect();
                    if (newBrokerClient) {
                        this.brokerClient = newBrokerClient;
                        connected = true;
                    } else {
                        logger.debug('');
                    }
                }

                if (connected) {
                    logger.debug('Got active broker client');

                    await this.brokerClient.reset();
                    logger.debug('Reset broker client');

                    const clientRequest: BrokerMessage =
                        this._createClientRequest(
                            this.brokerClient.getFullConnectionName(),
                            nextInvocationResp.headers,
                            nextInvocationResp.data
                        );
                    if (logger.isDebugEnabled()) {
                        logger.debug(
                            `Sending client request to broker: ${logger.toJson(
                                clientRequest
                            )} ...`
                        );
                    }

                    const requestId: string =
                        nextInvocationResp.headers[
                            LAMBDA_RUNTIME_AWS_REQUEST_ID_HEADER_NAME
                        ];
                    const remainingTime: number =
                        parseInt(
                            nextInvocationResp.headers[
                                LAMBDA_RUNTIME_DEADLINE_MS_HEADER_NAME
                            ]
                        ) - Date.now();
                    const clientResponse: BrokerMessage | void =
                        await this.brokerClient
                            .sendAndGetResponse(clientRequest, remainingTime)
                            .catch((err: Error) => {
                                logger.error(
                                    'Unable to send message and get response from broker',
                                    err
                                );
                            });
                    if (logger.isDebugEnabled()) {
                        logger.debug(
                            `Got client response from broker: ${logger.toJson(
                                clientResponse
                            )}`
                        );
                    }
                    if (clientResponse) {
                        if (clientResponse.error) {
                            if (clientResponse.error.internal) {
                                logger.debug(
                                    `Internal client request error: ${clientResponse.error.message}`
                                );
                            } else {
                                logger.debug(
                                    `Client request error: ${logger.toJson(
                                        clientResponse.error
                                    )}`
                                );

                                const invocationErrorURL =
                                    `http://${process.env.AWS_LAMBDA_RUNTIME_API}${INVOCATION_ERROR_PATH}`.replace(
                                        REQUEST_ID_PATH_PARAM,
                                        requestId
                                    );

                                if (logger.isDebugEnabled()) {
                                    logger.debug(
                                        `Sending invocation error to real AWS Lambda runtime API at ${invocationErrorURL} ...`
                                    );
                                }

                                // Send invocation error response to real AWS Lambda runtime API
                                const invocationErrorResponseResp: AxiosResponse =
                                    await axios.post(invocationErrorURL, {
                                        errorType: clientResponse.error.type,
                                        errorMessage:
                                            clientResponse.error.message ||
                                            clientResponse.error.type,
                                        trace: clientResponse.error.stackTrace,
                                    });

                                if (logger.isDebugEnabled()) {
                                    logger.debug(
                                        `Sent invocation error to real AWS Lambda runtime API at ${invocationErrorURL}: ` +
                                            `${logger.toJson(
                                                invocationErrorResponseResp
                                            )}`
                                    );
                                }

                                forwardToRealLambdaRuntime = false;
                            }
                        } else if (
                            clientResponse.data &&
                            clientResponse.data.response
                        ) {
                            logger.debug(
                                `Client request response: ${clientResponse.data.response}`
                            );

                            const invocationResponseURL =
                                `http://${process.env.AWS_LAMBDA_RUNTIME_API}${INVOCATION_RESPONSE_PATH}`.replace(
                                    REQUEST_ID_PATH_PARAM,
                                    requestId
                                );

                            if (logger.isDebugEnabled()) {
                                logger.debug(
                                    `Sending invocation response to real AWS Lambda runtime API at ${invocationResponseURL} ...`
                                );
                            }

                            // Send invocation response to real AWS Lambda runtime API
                            const nextInvocationResponseResp: AxiosResponse =
                                await axios.post(
                                    invocationResponseURL,
                                    clientResponse.data.response
                                );

                            if (logger.isDebugEnabled()) {
                                logger.debug(
                                    `Sent invocation response to real AWS Lambda runtime API at ${invocationResponseURL}: ` +
                                        `${logger.toJson(
                                            nextInvocationResponseResp
                                        )}`
                                );
                            }

                            forwardToRealLambdaRuntime = false;
                        } else {
                            logger.debug(
                                'No data or error could be found in client response'
                            );
                        }
                    } else {
                        logger.debug('No client response could be received');
                    }
                } else {
                    logger.debug('Could not get active broker client');
                }
            } catch (err: any) {
                logger.debug('Error occurred while driving invocation', err);
            }

            if (forwardToRealLambdaRuntime) {
                const invocationRequest: InvocationRequest = {
                    data: nextInvocationResp.data,
                    status: nextInvocationResp.status,
                    headers: nextInvocationResp.headers,
                };
                if (logger.isDebugEnabled()) {
                    logger.debug(
                        `Queueing invocation request to be forwarded to real AWS Lambda runtime: ${logger.toJson(
                            invocationRequest
                        )}`
                    );
                }
                // Push invocation request to the queue,
                // so it will be popped and used by next invocation request
                // coming here from original function process.
                this.invocationRequestQueue.push(invocationRequest);
            } else {
                process.nextTick(() => this.handleCurrentInvocation());
            }
        } catch (err: any) {
            logger.error(
                'Unable to get next invocation request from real AWS Lambda runtime API',
                err
            );
        }
    }

    async getInvocationRequest(): Promise<InvocationRequest> {
        return this.invocationRequestQueue.pop();
    }
}
