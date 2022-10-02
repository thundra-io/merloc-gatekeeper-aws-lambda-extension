const logger = require('../logger');
const axios = require('axios').default;

const LAMBDA_EXTENSION_VERSION = '2020-01-01';
const LAMBDA_EXTENSION_NAME = 'lambda-extension-name';
const LAMBDA_EXTENSION_IDENTIFIER = 'lambda-extension-identifier';

class ExtensionClient {
    constructor() {}

    getExtensionId() {
        return this.extensionId;
    }

    async register(name, events) {
        const headers = {
            [LAMBDA_EXTENSION_NAME]: name,
            'Content-Type': 'application/json',
        };
        const body = {
            events: events,
        };

        const url = `http://${process.env.AWS_LAMBDA_RUNTIME_API}/${LAMBDA_EXTENSION_VERSION}/extension/register`;
        const bodyJson = JSON.stringify(body);

        if (logger.isDebugEnabled()) {
            logger.debug(
                `Sending register request to ${url}: ` +
                    `headers=${logger.toJson(headers)}, body={${bodyJson}`
            );
        }

        const res = await axios.post(url, bodyJson, { headers });

        if (logger.isDebugEnabled()) {
            logger.debug(`Register request response: ${logger.toJson(res)}`);
        }

        if (res.status !== 200) {
            throw new Error(`Failed to register extension: ${res.status}`);
        }

        this.extensionId = res.headers[LAMBDA_EXTENSION_IDENTIFIER];

        return this.extensionId;
    }

    async nextEvent(id) {
        if (!id && !this.extensionId) {
            throw new Error('Extension ID is not set');
        }

        const headers = {
            [LAMBDA_EXTENSION_IDENTIFIER]: id || this.extensionId,
            'Content-Type': 'application/json',
        };

        const url = `http://${process.env.AWS_LAMBDA_RUNTIME_API}/${LAMBDA_EXTENSION_VERSION}/extension/event/next`;

        if (logger.isDebugEnabled()) {
            logger.debug(
                `Sending next event request to ${url}: ` +
                    `headers=${logger.toJson(headers)}`
            );
        }

        const res = await axios.get(url, { headers });

        if (logger.isDebugEnabled()) {
            logger.debug(`Next event request response: ${logger.toJson(res)}`);
        }

        if (res.status !== 200) {
            throw new Error(`Failed to get next event: ${res.status}`);
        }
    }
}

module.exports = {
    ExtensionClient,
};
