/*
 * Copyright @ 2018-present Atlassian Pty Ltd
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package org.jitsi.meet.sdk;

import android.util.Log;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import org.jitsi.meet.sdk.net.NAT64AddrInfo;

import java.net.UnknownHostException;

/**
 * This module exposes the functionality of creating an IPv6 representation
 * of IPv4 addresses in NAT64 environment.
 *
 * See[1] and [2] for more info on what NAT64 is.
 * [1]: https://tools.ietf.org/html/rfc6146
 * [2]: https://tools.ietf.org/html/rfc6052
 */
public class NAT64InfoModule extends ReactContextBaseJavaModule {
    /**
     * The name of this module.
     */
    private final static String MODULE_NAME = "NAT64Info";

    /**
     * How long is the {@link NAT64AddrInfo} instance valid.
     */
    private final static long INFO_LIFETIME = 60 * 1000;

    /**
     * The host for which the module wil try to resolve both IPv4 and IPv6
     * addresses in order to figure out the NAT64 prefix.
     */
    private final static String HOST = "nat64.jitsi.net";

    /**
     * The {@code Log} tag {@code NAT64InfoModule} is to log messages with.
     */
    private final static String TAG = MODULE_NAME;

    /**
     * The {@link NAT64AddrInfo} instance which holds NAT64 prefix/suffix.
     */
    private NAT64AddrInfo natInfo;

    /**
     * When {@link #natInfo} was created.
     */
    private long createTimestamp;

    /**
     * Creates new {@link NAT64InfoModule}.
     * @param reactContext the react context to be used by the new module
     * instance.
     */
    NAT64InfoModule(ReactApplicationContext reactContext) {
        super(reactContext);
    }

    /**
     * Tries to obtain IPv6 address for given IPv4 address in NAT64 environment.
     * @param ipv4Address IPv4 address string.
     * @param promise a {@link Promise} which will be resolved either with IPv6
     * address for given IPv4 address or with {@code null} if no
     * {@link NAT64AddrInfo} was resolved for the current network. Will be
     * rejected if given {@code ipv4Address} is not a valid IPv4 address.
     */
    @ReactMethod
    public void getIPv6Address(String ipv4Address, final Promise promise) {
        // Reset if cached for too long
        if (System.currentTimeMillis() - createTimestamp > INFO_LIFETIME) {
            natInfo = null;
        }
        String host = HOST;

        if (natInfo == null) {
            try {
                natInfo = NAT64AddrInfo.discover(host);
            } catch (UnknownHostException e) {
                Log.e(TAG, "NAT64AddrInfo.discover: " + host, e);
            }
            createTimestamp = System.currentTimeMillis();
        }

        try {
            String result
                = natInfo != null ? natInfo.getIPv6Address(ipv4Address) : null;

            promise.resolve(result);
        } catch (IllegalArgumentException exc) {
            Log.e(TAG, "Failed to get IPv6 address for: " + ipv4Address, exc);

            // We don't want to reject. It's not a big deal if there's no IPv6
            // address resolved.
            promise.resolve(null);
        }
    }

    @Override
    public String getName() {
        return MODULE_NAME;
    }
}
