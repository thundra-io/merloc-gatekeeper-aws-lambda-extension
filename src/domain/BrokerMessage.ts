import { Error } from './Error';

export type BrokerMessage = {
    id: string;
    connectionName: string;
    type: string;
    responseOf?: string;
    sourceConnectionId?: string;
    sourceConnectionType?: string;
    targetConnectionId?: string;
    targetConnectionType?: string;
    error?: Error;
    data?: any;
};
