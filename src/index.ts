import * as logger from './logger';
import ExtensionClient from './client/ExtensionClient';

import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import axios, { AxiosRequestHeaders, AxiosResponse } from 'axios';

const app = express();
app.use(bodyParser.json());

const MERLOC_GATEKEEPER_EXTENSION_NAME = 'merloc-gatekeeper';
const MERLOC_GATEKEEPER_RUNTIME_API_PORT = 9100;
const INIT_ERROR_PATH = '/2018-06-01/runtime/init/error';
const NEXT_INVOCATION_PATH = '/2018-06-01/runtime/invocation/next';
const INVOCATION_RESPONSE_PATH =
    '/2018-06-01/runtime/invocation/:requestId/response';
const INVOCATION_ERROR_PATH = '/2018-06-01/runtime/invocation/:requestId/error';

async function _initExtension() {
    logger.debug('Initializing extension ...');

    logger.debug('Creating extensions client ...');
    const client: ExtensionClient = new ExtensionClient();
    logger.debug('Created extensions client');

    logger.debug('Registering extension ...');
    const id: string = await client.register(MERLOC_GATEKEEPER_EXTENSION_NAME, []);
    logger.debug(`Registered extension with id ${id}`);

    if (!id) {
        logger.error(
            'Extension ID is not set. Skipping extension registration ...'
        );
        return;
    }

    logger.debug('Calling for next event ...');
    await client.nextEvent(id);
    logger.debug('Called for next event');
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
    await _forwardRequest(request, response);
});

app.post(INVOCATION_RESPONSE_PATH, async (request: Request, response: Response) => {
    await _forwardRequest(request, response);
});

app.post(INVOCATION_ERROR_PATH, async (request: Request, response: Response) => {
    await _forwardRequest(request, response);
});

app.listen(MERLOC_GATEKEEPER_RUNTIME_API_PORT, function () {
    logger.info(
        `MerLoc GateKeeper Runtime API listening on port ${MERLOC_GATEKEEPER_RUNTIME_API_PORT}`
    );
});

_initExtension();
