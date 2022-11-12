import { Error } from './Error';

export type BrokerEnvelope = {
    id: string;
    connectionName: string;
    type: string;
    time: number;
    responseOf?: string;
    sourceConnectionId?: string;
    sourceConnectionType?: string;
    targetConnectionId?: string;
    targetConnectionType?: string;
    payload: string;
    fragmented?: boolean;
    fragmentNo?: number;
    fragmentCount?: number;
};

export type BrokerPayload = {
    error?: Error;
    data?: any;
};
