export type Error = {
    type: string;
    message?: string;
    stackTrace?: string[];
    code?: number;
    internal?: boolean;
};
