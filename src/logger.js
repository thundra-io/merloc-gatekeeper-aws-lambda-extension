const { MERLOC_GATEKEEPER_DEBUG_ENABLED } = require('./configs');

module.exports.isDebugEnabled = function () {
    return MERLOC_GATEKEEPER_DEBUG_ENABLED;
};

module.exports.debug = function (msg) {
    if (MERLOC_GATEKEEPER_DEBUG_ENABLED) {
        console.debug('[MERLOC-GATEKEEPER]', msg);
    }
};

module.exports.info = function (msg) {
    console.info('[MERLOC-GATEKEEPER]', msg);
};

module.exports.warn = function (msg) {
    console.warn('[MERLOC-GATEKEEPER]', msg);
};

module.exports.error = function (msg, e) {
    console.error('[MERLOC-GATEKEEPER]', msg, e);
};

function _getCircularReplacer() {
    const seen = new WeakSet();
    return (key, value) => {
        if (typeof value === 'object' && value !== null) {
            if (seen.has(value)) {
                return;
            }
            seen.add(value);
        }
        return value;
    };
}

module.exports.toJson = function (obj) {
    return JSON.stringify(obj, _getCircularReplacer());
};
