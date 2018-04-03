// @flow

import { NativeModules } from 'react-native';
import { RTCPeerConnection, RTCSessionDescription } from 'react-native-webrtc';

/* eslint-disable no-unused-vars */

// Address families.
const AF_INET6 = 30; /* IPv6 */

// Protocols (RFC 1700)
const IPPROTO_TCP = 6; /* tcp */
const IPPROTO_UDP = 17; /* user datagram protocol */

// Protocol families, same as address families for now.
const PF_INET6 = AF_INET6;

const SOCK_DGRAM = 2; /* datagram socket */
const SOCK_STREAM = 1; /* stream socket */

/* eslint-enable no-unused-vars */

// XXX At the time of this writing extending RTCPeerConnection using ES6 'class'
// and 'extends' causes a runtime error related to the attempt to define the
// onaddstream property setter. The error mentions that babelHelpers.set is
// undefined which appears to be a thing inside React Native's packager. As a
// workaround, extend using the pre-ES6 way.

/**
 * The RTCPeerConnection provided by react-native-webrtc fires onaddstream
 * before it remembers remotedescription (and thus makes it available to API
 * clients). Because that appears to be a problem for lib-jitsi-meet which has
 * been successfully running on Chrome, Firefox, Temasys, etc. for a very long
 * time, attempt to meets its expectations (by extending RTCPPeerConnection).
 *
 * @class
 */
export default function _RTCPeerConnection(...args: any[]) {

    /* eslint-disable indent, no-invalid-this */

    RTCPeerConnection.apply(this, args);

    this.onaddstream = (...args) => // eslint-disable-line no-shadow
        (this._onaddstreamQueue
                ? this._queueOnaddstream
                : this._invokeOnaddstream)
            .apply(this, args);

    // Shadow RTCPeerConnection's onaddstream but after _RTCPeerConnection has
    // assigned to the property in question. Defining the property on
    // _RTCPeerConnection's prototype may (or may not, I don't know) work but I
    // don't want to try because the following approach appears to work and I
    // understand it.

    // $FlowFixMe
    Object.defineProperty(this, 'onaddstream', {
        configurable: true,
        enumerable: true,
        get() {
            return this._onaddstream;
        },
        set(value) {
            this._onaddstream = value;
        }
    });

    /* eslint-enable indent, no-invalid-this */
}

_RTCPeerConnection.prototype = Object.create(RTCPeerConnection.prototype);
_RTCPeerConnection.prototype.constructor = _RTCPeerConnection;

_RTCPeerConnection.prototype.addIceCandidate
    = _makePromiseAware(RTCPeerConnection.prototype.addIceCandidate, 1, 0);

_RTCPeerConnection.prototype.createAnswer
    = _makePromiseAware(RTCPeerConnection.prototype.createAnswer, 0, 1);
_RTCPeerConnection.prototype.createOffer
    = _makePromiseAware(RTCPeerConnection.prototype.createOffer, 0, 1);

_RTCPeerConnection.prototype._invokeOnaddstream = function(...args) {
    const onaddstream = this._onaddstream;

    return onaddstream && onaddstream.apply(this, args);
};

_RTCPeerConnection.prototype._invokeQueuedOnaddstream = function(q) {
    q && q.forEach(args => {
        try {
            this._invokeOnaddstream(...args);
        } catch (e) {
            // TODO Determine whether the combination of the standard
            // setRemoteDescription and onaddstream results in a similar
            // swallowing of errors.
            _LOGE(e);
        }
    });
};

_RTCPeerConnection.prototype._queueOnaddstream = function(...args) {
    this._onaddstreamQueue.push(Array.from(args));
};

_RTCPeerConnection.prototype.setLocalDescription
  = _makePromiseAware(RTCPeerConnection.prototype.setLocalDescription, 1, 0);

_RTCPeerConnection.prototype.setRemoteDescription = function(
        sessionDescription,
        successCallback,
        errorCallback) {
    // If the deprecated callback-based version is used, translate it to the
    // Promise-based version.
    if (typeof successCallback !== 'undefined'
            || typeof errorCallback !== 'undefined') {
        // XXX Returning a Promise is not necessary. But I don't see why it'd
        // hurt (much).
        return (
            _RTCPeerConnection.prototype.setRemoteDescription.call(
                    this,
                    sessionDescription)
                .then(successCallback, errorCallback));
    }

    return (
        _synthesizeIPv6Addresses(sessionDescription)
            .catch(reason => {
                reason && _LOGE(reason);

                return sessionDescription;
            })
            .then(value => _setRemoteDescription.bind(this)(value)));

};

/**
 * Logs at error level.
 *
 * @private
 * @returns {void}
 */
function _LOGE(...args) {
    console && console.error && console.error(...args);
}

/**
 * Makes a {@code Promise}-returning function out of a specific void function
 * with {@code successCallback} and {@code failureCallback}.
 *
 * @param {Function} f - The (void) function with {@code successCallback} and
 * {@code failureCallback}.
 * @param {number} beforeCallbacks - The number of arguments before
 * {@code successCallback} and {@code failureCallback}.
 * @param {number} afterCallbacks - The number of arguments after
 * {@code successCallback} and {@code failureCallback}.
 * @returns {Promise}
 */
function _makePromiseAware(
        f: Function,
        beforeCallbacks: number,
        afterCallbacks: number) {
    return function(...args) {
        return new Promise((resolve, reject) => {
            if (args.length <= beforeCallbacks + afterCallbacks) {
                args.splice(beforeCallbacks, 0, resolve, reject);
            }

            let fPromise;

            try {
                // eslint-disable-next-line no-invalid-this
                fPromise = f.apply(this, args);
            } catch (e) {
                reject(e);
            }

            // If the super implementation returns a Promise from the deprecated
            // invocation by any chance, try to make sense of it.
            if (fPromise) {
                const { then } = fPromise;

                typeof then === 'function'
                    && then.call(fPromise, resolve, reject);
            }
        });
    };
}

/**
 * Adapts react-native-webrtc's {@link RTCPeerConnection#setRemoteDescription}
 * implementation which uses the deprecated, callback-based version to the
 * {@code Promise}-based version.
 *
 * @param {RTCSessionDescription} sessionDescription - The RTCSessionDescription
 * which specifies the configuration of the remote end of the connection.
 * @private
 * @private
 * @returns {Promise}
 */
function _setRemoteDescription(sessionDescription) {
    return new Promise((resolve, reject) => {

        /* eslint-disable no-invalid-this */

        // Ensure I'm not remembering onaddstream invocations from previous
        // setRemoteDescription calls. I shouldn't be but... anyway.
        this._onaddstreamQueue = [];

        RTCPeerConnection.prototype.setRemoteDescription.call(
            this,
            sessionDescription,
            (...args) => {
                let q;

                try {
                    resolve(...args);
                } finally {
                    q = this._onaddstreamQueue;
                    this._onaddstreamQueue = undefined;
                }

                this._invokeQueuedOnaddstream(q);
            },
            (...args) => {
                this._onaddstreamQueue = undefined;

                reject(...args);
            });

        /* eslint-enable no-invalid-this */
    });
}

/**
 * Synthesize IPv6 addresses on iOS in order to support IPv6 NAT64 networks.
 *
 * @param {RTCSessionDescription} sdp - The RTCSessionDescription which
 * specifies the configuration of the remote end of the connection.
 * @private
 * @returns {Promise}
 */
function _synthesizeIPv6Addresses(sdp) {
    // The synthesis of IPv6 addresses on iOS is implemented using POSIX
    // 'getaddrinfo' and on Android by custom module which figures out a NAT64
    // prefix.
    if (!NativeModules.POSIX && !NativeModules.NAT64Info) {
        return Promise.resolve(sdp);
    }

    return (
        new Promise(resolve => resolve(_synthesizeIPv6Addresses0(sdp)))
            .then(({ ips, lines }) =>
                Promise.all(Array.from(ips.values()))
                    .then(() => _synthesizeIPv6Addresses1(sdp, ips, lines))
            ));
}

/* eslint-disable max-depth */

/**
 * Begins the asynchronous synthesis of IPv6 addresses.
 *
 * @param {RTCSessionDescription} sessionDescription - The RTCSessionDescription
 * for which IPv6 addresses will be synthesized.
 * @private
 * @returns {{
 *     ips: Map,
 *     lines: Array
 * }}
 */
function _synthesizeIPv6Addresses0(sessionDescription) {
    const sdp = sessionDescription.sdp;
    let start = 0;
    const lines = [];
    const ips = new Map();
    const getaddrinfo = NativeModules.POSIX && NativeModules.POSIX.getaddrinfo;
    const getIPv6Address
        = NativeModules.NAT64Info && NativeModules.NAT64Info.getIPv6Address;

    do {
        const end = sdp.indexOf('\r\n', start);
        let line;

        if (end === -1) {
            line = sdp.substring(start);

            // Break out of the loop at the end of the iteration.
            start = undefined;
        } else {
            line = sdp.substring(start, end);
            start = end + 2;
        }

        if (line.startsWith('a=candidate:')) {
            const candidate = line.split(' ');

            if (candidate.length >= 10 && candidate[6] === 'typ') {
                const ip4s = [ candidate[4] ];
                let abort = false;

                for (let i = 8; i < candidate.length; ++i) {
                    if (candidate[i] === 'raddr') {
                        ip4s.push(candidate[++i]);
                        break;
                    }
                }

                for (const ip of ip4s) {
                    if (ip.indexOf(':') === -1) {
                        ips.has(ip)
                            || ips.set(ip, new Promise((resolve, reject) => {
                                const v = ips.get(ip);

                                // Even though getaddrinfo and getIPv6Address
                                // do not always return exactly the same thing,
                                // it's possible to have one handler capable of
                                // handling both results.
                                const onFullfilled = value => {
                                    if (!value
                                        || value.indexOf(':') === -1
                                        || value === ips.get(ip)) {
                                        ips.delete(ip);
                                    } else {
                                        ips.set(ip, value);
                                    }
                                    resolve(value);
                                };

                                if (v && typeof v === 'string') {
                                    resolve(v);
                                } else if (typeof getaddrinfo === 'function') {
                                    getaddrinfo(ip, undefined).then(
                                        ([ { ai_addr: value } ]) => {
                                            onFullfilled(value);
                                        },
                                        reject);
                                } else if (
                                    typeof getIPv6Address === 'function') {
                                    getIPv6Address(ip).then(
                                        value => onFullfilled(value),
                                        reject);
                                } else {
                                    reject(
                                        'The impossible just happened (no POSIX'
                                            + ' nor NAT64Info module'
                                            + ' available)');
                                }
                            }));
                    } else {
                        abort = true;
                        break;
                    }
                }
                if (abort) {
                    ips.clear();
                    break;
                }

                line = candidate;
            }
        }

        lines.push(line);
    } while (start);

    return {
        ips,
        lines
    };
}

/* eslint-enable max-depth */

/**
 * Completes the asynchronous synthesis of IPv6 addresses.
 *
 * @param {RTCSessionDescription} sessionDescription - The RTCSessionDescription
 * for which IPv6 addresses are being synthesized.
 * @param {Map} ips - A Map of IPv4 addresses found in the specified
 * sessionDescription to synthesized IPv6 addresses.
 * @param {Array} lines - The lines of the specified sessionDescription.
 * @private
 * @returns {RTCSessionDescription} A RTCSessionDescription that represents the
 * result of the synthesis of IPv6 addresses.
 */
function _synthesizeIPv6Addresses1(sessionDescription, ips, lines) {
    if (ips.size === 0) {
        return sessionDescription;
    }

    for (let l = 0; l < lines.length; ++l) {
        const candidate = lines[l];

        if (typeof candidate !== 'string') {
            let ip4 = candidate[4];
            let ip6 = ips.get(ip4);

            ip6 && (candidate[4] = ip6);

            for (let i = 8; i < candidate.length; ++i) {
                if (candidate[i] === 'raddr') {
                    ip4 = candidate[++i];
                    (ip6 = ips.get(ip4)) && (candidate[i] = ip6);
                    break;
                }
            }

            lines[l] = candidate.join(' ');
        }
    }

    return new RTCSessionDescription({
        sdp: lines.join('\r\n'),
        type: sessionDescription.type
    });
}
