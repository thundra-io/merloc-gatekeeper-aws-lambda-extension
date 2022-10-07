import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import axios, { AxiosRequestHeaders, AxiosResponse } from 'axios';

import * as logger from './logger';
import ExtensionClient from './client/ExtensionClient';
import BrokerClient from './client/BrokerClient';
import Runtime, { InvocationRequest } from './Runtime';

import {
    MERLOC_GATEKEEPER_EXTENSION_NAME,
    MERLOC_GATEKEEPER_RUNTIME_API_PORT,
    INIT_ERROR_PATH,
    NEXT_INVOCATION_PATH,
    INVOCATION_RESPONSE_PATH,
    INVOCATION_ERROR_PATH,
} from './constants';
import {
    MERLOC_ENABLED,
    MERLOC_BROKER_URL,
    MERLOC_BROKER_CONNECTION_NAME,
} from './configs';

const app = express();
app.use(bodyParser.json());

let extensionClient: ExtensionClient | undefined;
let brokerClient: BrokerClient | undefined;
let runtime: Runtime;
let initPromise: Promise<void>;

async function _initExtension(): Promise<ExtensionClient | undefined> {
    logger.debug('Initializing extension ...');

    logger.debug('Creating extension client ...');
    const client: ExtensionClient = new ExtensionClient();
    logger.debug('Created extension client');

    logger.debug('Registering extension ...');
    const id: string = await client.register(
        MERLOC_GATEKEEPER_EXTENSION_NAME,
        []
    );
    logger.debug(`Registered extension with id ${id}`);

    if (!id) {
        logger.error(
            'Extension ID is not set. Skipping extension registration ...'
        );
        return;
    }

    logger.debug('Calling for next event ...');
    client.nextEvent(id);

    logger.debug('Initialized extension');

    return client;
}

async function _initBroker(): Promise<BrokerClient | undefined> {
    logger.debug('Initializing broker ...');

    return new Promise<BrokerClient | undefined>((res, rej) => {
        logger.debug('Creating broker client ...');
        if (!MERLOC_ENABLED) {
            logger.debug(
                'MerLoc is disabled, so requests will be forwarded to the actual handler'
            );
            return res(undefined);
        }
        if (!MERLOC_BROKER_URL) {
            logger.debug(
                'Broker URL is empty so requests will be forwarded to the actual handler'
            );
            return res(undefined);
        }
        const client: BrokerClient = new BrokerClient(
            MERLOC_BROKER_URL,
            MERLOC_BROKER_CONNECTION_NAME
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

async function _init(): Promise<void> {
    extensionClient = await _initExtension();
    if (!extensionClient) {
        logger.debug(
            'Extension client could not be initialized. So skipping MerLoc Gatekeeper initialization.'
        );
        return;
    }

    brokerClient = await _initBroker();
    if (!brokerClient) {
        logger.debug(
            'Broker client could not be initialized. So skipping MerLoc Gatekeeper initialization.'
        );
        return;
    }

    runtime = new Runtime(extensionClient, brokerClient);

    runtime.handleCurrentInvocation();
}

async function _forwardRequest(request: Request, response: Response) {
    logger.debug(`Received "${request.path}" request `);

    const pathToForwardRequest: string = `http://${process.env.AWS_LAMBDA_RUNTIME_API}${request.path}`;
    const headers: AxiosRequestHeaders = {};
    if (request.headers) {
        for (const [name, value] of Object.entries(request.headers)) {
            headers[name] = value as string | number | boolean;
        }
    }

    logger.debug(
        `Forwarding request to ${pathToForwardRequest}: ` +
            `headers=${logger.toJson(headers)}, body=${logger.toJson(
                request.body
            )} ...`
    );

    let res: AxiosResponse;
    if (request.method === 'GET') {
        res = await axios.get(pathToForwardRequest, { headers });
    } else if (request.method === 'POST') {
        res = await axios.post(pathToForwardRequest, request.body, { headers });
    } else {
        throw new Error(`Unexpected request method: ${request.method}`);
    }

    if (logger.isDebugEnabled()) {
        logger.debug(`Response to forwarded request: ${logger.toJson(res)}`);
    }

    if (res.headers) {
        for (const [name, value] of Object.entries(res.headers)) {
            response.setHeader(name, value);
        }
    }
    response.status(res.status);
    response.send(res.data);

    logger.debug(`Returned response to "${request.path}" request`);
}

app.post(INIT_ERROR_PATH, async (request: Request, response: Response) => {
    await _forwardRequest(request, response);
});

app.get(NEXT_INVOCATION_PATH, async (request: Request, response: Response) => {
    logger.debug(`Getting invocation request from MerLoc runtime API ...`);

    // Be sure that init stuff has completed
    await initPromise;

    if (!runtime) {
        logger.debug(
            `MerLoc runtime is disable, so forwarding to real AWS Lambda runtime API`
        );
        await _forwardRequest(request, response);
        return;
    }

    const invocationRequest: InvocationRequest | void = await runtime
        .getInvocationRequest()
        .catch((err: Error) => {
            logger.error(
                `Unable to get invocation request from MerLoc runtime API ` +
                    `to forward to the original Lambda function`,
                err
            );
        });
    if (invocationRequest) {
        if (logger.isDebugEnabled()) {
            logger.debug(
                `Got invocation request from MerLoc runtime API ` +
                    `to forward to the original Lambda function: ${logger.toJson(
                        invocationRequest
                    )}`
            );
        }
        if (invocationRequest.headers) {
            for (const [name, value] of Object.entries(
                invocationRequest.headers
            )) {
                response.setHeader(name, value);
            }
        }
        response.status(invocationRequest.status);
        response.send(invocationRequest.data);
    } else {
        logger.debug(
            `No invocation request could be taken from MerLoc runtime API, ` +
                `so forwarding to real AWS Lambda runtime API`
        );
        await _forwardRequest(request, response);
    }
});

app.post(
    INVOCATION_RESPONSE_PATH,
    async (request: Request, response: Response) => {
        try {
            await _forwardRequest(request, response);
        } finally {
            if (runtime) {
                process.nextTick(() => runtime.handleCurrentInvocation());
            }
        }
    }
);

app.post(
    INVOCATION_ERROR_PATH,
    async (request: Request, response: Response) => {
        try {
            await _forwardRequest(request, response);
        } finally {
            if (runtime) {
                process.nextTick(() => runtime.handleCurrentInvocation());
            }
        }
    }
);

app.listen(MERLOC_GATEKEEPER_RUNTIME_API_PORT, function () {
    logger.debug(
        `MerLoc GateKeeper Runtime API listening on port ${MERLOC_GATEKEEPER_RUNTIME_API_PORT}`
    );
});

initPromise = _init();
