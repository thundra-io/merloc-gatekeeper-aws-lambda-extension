const { MERLOC_GATEKEEPER_DEBUG_ENABLED } = require('./configs');

export function isDebugEnabled(): boolean {
    return MERLOC_GATEKEEPER_DEBUG_ENABLED;
}

export function debug(msg: string): void {
    if (MERLOC_GATEKEEPER_DEBUG_ENABLED) {
        console.debug('[MERLOC-GATEKEEPER]', msg);
    }
}

export function info(msg: string): void {
    console.info('[MERLOC-GATEKEEPER]', msg);
}

export function warn(msg: string): void {
    console.warn('[MERLOC-GATEKEEPER]', msg);
}

export function error(msg: string, e?: Error): void {
    console.error('[MERLOC-GATEKEEPER]', msg, e);
}

function _getCircularReplacer() {
    const seen = new WeakSet();
    return (key: string, value: any) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    };
}

export function toJson(obj: any): string {
    return JSON.stringify(obj, _getCircularReplacer());
}
