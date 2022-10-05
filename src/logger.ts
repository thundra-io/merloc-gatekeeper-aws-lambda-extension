const { MERLOC_DEBUG_ENABLED } = require('./configs');

export function isDebugEnabled(): boolean {
    return MERLOC_DEBUG_ENABLED;
}

export function debug(...args: any[]): void {
    if (MERLOC_DEBUG_ENABLED) {
        console.debug('[MERLOC-GATEKEEPER]', ...args);
    }
}

export function info(...args: any[]): void {
    console.info('[MERLOC-GATEKEEPER]', ...args);
}

export function warn(...args: any[]): void {
    console.warn('[MERLOC-GATEKEEPER]', ...args);
}

export function error(...args: any[]): void {
    console.error('[MERLOC-GATEKEEPER]', ...args);
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
