(()=>{"use strict";module.exports = [
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/forbidden.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "forbidden", {
    enumerable: true,
    get: function() {
        return forbidden;
    }
});
const _httpaccessfallback = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/http-access-fallback/http-access-fallback.js [app-ssr] (ecmascript)");
// TODO: Add `forbidden` docs
/**
 * @experimental
 * This function allows you to render the [forbidden.js file](https://nextjs.org/docs/app/api-reference/file-conventions/forbidden)
 * within a route segment as well as inject a tag.
 *
 * `forbidden()` can be used in
 * [Server Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components),
 * [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers), and
 * [Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations).
 *
 * Read more: [Next.js Docs: `forbidden`](https://nextjs.org/docs/app/api-reference/functions/forbidden)
 */ const DIGEST = `${_httpaccessfallback.HTTP_ERROR_FALLBACK_ERROR_CODE};403`;
function forbidden() {
    if ("TURBOPACK compile-time truthy", 1) {
        throw new Error(`\`forbidden()\` is experimental and only allowed to be enabled when \`experimental.authInterrupts\` is enabled.`);
    }
    const error = new Error(DIGEST);
    error.digest = DIGEST;
    throw error;
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/hooks-server-context.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    DynamicServerError: null,
    isDynamicServerError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    DynamicServerError: function() {
        return DynamicServerError;
    },
    isDynamicServerError: function() {
        return isDynamicServerError;
    }
});
const DYNAMIC_ERROR_CODE = 'DYNAMIC_SERVER_USAGE';
class DynamicServerError extends Error {
    constructor(description){
        super(`Dynamic server usage: ${description}`), this.description = description, this.digest = DYNAMIC_ERROR_CODE;
    }
}
function isDynamicServerError(err) {
    if (typeof err !== 'object' || err === null || !('digest' in err) || typeof err.digest !== 'string') {
        return false;
    }
    return err.digest === DYNAMIC_ERROR_CODE;
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/http-access-fallback/http-access-fallback.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    HTTPAccessErrorStatus: null,
    HTTP_ERROR_FALLBACK_ERROR_CODE: null,
    getAccessFallbackErrorTypeByStatus: null,
    getAccessFallbackHTTPStatus: null,
    isHTTPAccessFallbackError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    HTTPAccessErrorStatus: function() {
        return HTTPAccessErrorStatus;
    },
    HTTP_ERROR_FALLBACK_ERROR_CODE: function() {
        return HTTP_ERROR_FALLBACK_ERROR_CODE;
    },
    getAccessFallbackErrorTypeByStatus: function() {
        return getAccessFallbackErrorTypeByStatus;
    },
    getAccessFallbackHTTPStatus: function() {
        return getAccessFallbackHTTPStatus;
    },
    isHTTPAccessFallbackError: function() {
        return isHTTPAccessFallbackError;
    }
});
const HTTPAccessErrorStatus = {
    NOT_FOUND: 404,
    FORBIDDEN: 403,
    UNAUTHORIZED: 401
};
const ALLOWED_CODES = new Set(Object.values(HTTPAccessErrorStatus));
const HTTP_ERROR_FALLBACK_ERROR_CODE = 'NEXT_HTTP_ERROR_FALLBACK';
function isHTTPAccessFallbackError(error) {
    if (typeof error !== 'object' || error === null || !('digest' in error) || typeof error.digest !== 'string') {
        return false;
    }
    const [prefix, httpStatus] = error.digest.split(';');
    return prefix === HTTP_ERROR_FALLBACK_ERROR_CODE && ALLOWED_CODES.has(Number(httpStatus));
}
function getAccessFallbackHTTPStatus(error) {
    const httpStatus = error.digest.split(';')[1];
    return Number(httpStatus);
}
function getAccessFallbackErrorTypeByStatus(status) {
    switch(status){
        case 401:
            return 'unauthorized';
        case 403:
            return 'forbidden';
        case 404:
            return 'not-found';
        default:
            return;
    }
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/is-next-router-error.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "isNextRouterError", {
    enumerable: true,
    get: function() {
        return isNextRouterError;
    }
});
const _httpaccessfallback = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/http-access-fallback/http-access-fallback.js [app-ssr] (ecmascript)");
const _redirecterror = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/redirect-error.js [app-ssr] (ecmascript)");
function isNextRouterError(error) {
    return (0, _redirecterror.isRedirectError)(error) || (0, _httpaccessfallback.isHTTPAccessFallbackError)(error);
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/navigation-dynamic-rendering.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

// Client-safe access to the server-only dynamic-rendering hooks used by the
// navigation hooks. On the server these re-export the real implementations; in
// the browser bundle this module is aliased to
// `./navigation-dynamic-rendering.browser` (see
// scripts/generate-browser-variant-aliases.mjs), which exports `undefined` so
// the server module is not bundled into the client. Callers use optional calls
// (`useDynamicRouteParams?.(...)`), so the browser stub is a no-op.
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    useDynamicRouteParams: null,
    useDynamicSearchParams: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    useDynamicRouteParams: function() {
        return _dynamicrenderingclient.useDynamicRouteParams;
    },
    useDynamicSearchParams: function() {
        return _dynamicrenderingclient.useDynamicSearchParams;
    }
});
const _dynamicrenderingclient = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/app-render/dynamic-rendering-client.js [app-ssr] (ecmascript)");
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/navigation.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ReadonlyURLSearchParams: null,
    RedirectType: null,
    ServerInsertedHTMLContext: null,
    forbidden: null,
    notFound: null,
    permanentRedirect: null,
    redirect: null,
    unauthorized: null,
    unstable_isUnrecognizedActionError: null,
    unstable_rethrow: null,
    useParams: null,
    usePathname: null,
    useRouter: null,
    useSearchParams: null,
    useSelectedLayoutSegment: null,
    useSelectedLayoutSegments: null,
    useServerInsertedHTML: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    // We need the same class that was used to instantiate the context value
    // Otherwise instanceof checks will fail in usercode
    ReadonlyURLSearchParams: function() {
        return _hooksclientcontextsharedruntime.ReadonlyURLSearchParams;
    },
    RedirectType: function() {
        return _navigationreactserver.RedirectType;
    },
    ServerInsertedHTMLContext: function() {
        return _serverinsertedhtmlsharedruntime.ServerInsertedHTMLContext;
    },
    forbidden: function() {
        return _navigationreactserver.forbidden;
    },
    notFound: function() {
        return _navigationreactserver.notFound;
    },
    permanentRedirect: function() {
        return _navigationreactserver.permanentRedirect;
    },
    redirect: function() {
        return _navigationreactserver.redirect;
    },
    unauthorized: function() {
        return _navigationreactserver.unauthorized;
    },
    unstable_isUnrecognizedActionError: function() {
        return _unrecognizedactionerror.unstable_isUnrecognizedActionError;
    },
    unstable_rethrow: function() {
        return _navigationreactserver.unstable_rethrow;
    },
    useParams: function() {
        return useParams;
    },
    usePathname: function() {
        return usePathname;
    },
    useRouter: function() {
        return useRouter;
    },
    useSearchParams: function() {
        return useSearchParams;
    },
    useSelectedLayoutSegment: function() {
        return useSelectedLayoutSegment;
    },
    useSelectedLayoutSegments: function() {
        return useSelectedLayoutSegments;
    },
    useServerInsertedHTML: function() {
        return _serverinsertedhtmlsharedruntime.useServerInsertedHTML;
    }
});
const _interop_require_wildcard = __turbopack_context__.r("[project]/node_modules/.pnpm/@swc+helpers@0.5.23/node_modules/@swc/helpers/cjs/_interop_require_wildcard.cjs [app-ssr] (ecmascript)");
const _react = /*#__PURE__*/ _interop_require_wildcard._(__turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)"));
const _approutercontextsharedruntime = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/contexts/app-router-context.js [app-ssr] (ecmascript)");
const _hooksclientcontextsharedruntime = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/contexts/hooks-client-context.js [app-ssr] (ecmascript)");
const _segment = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/segment.js [app-ssr] (ecmascript)");
const _navigationdynamicrendering = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/navigation-dynamic-rendering.js [app-ssr] (ecmascript)");
const _serverinsertedhtmlsharedruntime = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/contexts/server-inserted-html.js [app-ssr] (ecmascript)");
const _unrecognizedactionerror = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/unrecognized-action-error.js [app-ssr] (ecmascript)");
const _navigationreactserver = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/navigation.react-server.js [app-ssr] (ecmascript)");
const { instrumentParamsForClientValidation, instrumentSearchParamsForClientValidation, expectCompleteParamsInClientValidation } = ("TURBOPACK compile-time falsy", 0) ? "TURBOPACK unreachable" : {};
function useSearchParams() {
    _navigationdynamicrendering.useDynamicSearchParams?.('useSearchParams()');
    const searchParams = (0, _react.useContext)(_hooksclientcontextsharedruntime.SearchParamsContext);
    // In the case where this is `null`, the compat types added in
    // `next-env.d.ts` will add a new overload that changes the return type to
    // include `null`.
    const readonlySearchParams = (0, _react.useMemo)(()=>{
        if (!searchParams) {
            // When the router is not ready in pages, we won't have the search params
            // available.
            return null;
        }
        return new _hooksclientcontextsharedruntime.ReadonlyURLSearchParams(searchParams);
    }, [
        searchParams
    ]);
    // During build-time instant validation, wrap with an proxy
    // so that accessing undeclared search params throws an error.
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    // Instrument with Suspense DevTools (dev-only)
    if (("TURBOPACK compile-time value", "development") !== 'production' && 'use' in _react.default) {
        const navigationPromises = (0, _react.use)(_hooksclientcontextsharedruntime.NavigationPromisesContext);
        if (navigationPromises) {
            return (0, _react.use)(navigationPromises.searchParams);
        }
    }
    return readonlySearchParams;
}
function usePathname() {
    _navigationdynamicrendering.useDynamicRouteParams?.('usePathname()');
    // In the case where this is `null`, the compat types added in `next-env.d.ts`
    // will add a new overload that changes the return type to include `null`.
    const pathname = (0, _react.useContext)(_hooksclientcontextsharedruntime.PathnameContext);
    // During build-time instant validation, error if fallback params exist
    // because usePathname() can't return a sensible value without all params.
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    // Instrument with Suspense DevTools (dev-only)
    if (("TURBOPACK compile-time value", "development") !== 'production' && 'use' in _react.default) {
        const navigationPromises = (0, _react.use)(_hooksclientcontextsharedruntime.NavigationPromisesContext);
        if (navigationPromises) {
            return (0, _react.use)(navigationPromises.pathname);
        }
    }
    return pathname;
}
function useRouter() {
    const router = (0, _react.useContext)(_approutercontextsharedruntime.AppRouterContext);
    if (router === null) {
        throw new Error('invariant expected app router to be mounted');
    }
    // Read the bfcacheId of the closest CacheNode and merge it into the
    // returned router instance. This is contextual: callers in a shared
    // layout get the layout's id; callers in a leaf segment get the leaf's.
    // The id is stored on the CacheNode as a number and materialized as a
    // string here. The format mirrors React's `useId()` (e.g. `_r_0_`) with
    // a `b` prefix, so the id can be safely concatenated with other keys
    // without collision.
    const layout = (0, _react.useContext)(_approutercontextsharedruntime.LayoutRouterContext);
    const bfcacheIdNumber = layout?.parentRenderTree.data.bfcacheId ?? 0;
    return (0, _react.useMemo)(()=>({
            back: router.back,
            forward: router.forward,
            refresh: router.refresh,
            hmrRefresh: router.hmrRefresh,
            push: router.push,
            replace: router.replace,
            prefetch: router.prefetch,
            experimental_gesturePush: router.experimental_gesturePush,
            bfcacheId: '_b_' + bfcacheIdNumber + '_'
        }), [
        router,
        bfcacheIdNumber
    ]);
}
function useParams() {
    _navigationdynamicrendering.useDynamicRouteParams?.('useParams()');
    const params = (0, _react.useContext)(_hooksclientcontextsharedruntime.PathParamsContext);
    // During build-time instant validation, wrap with a proxy
    // so that accessing undeclared params throws an error.
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    // Instrument with Suspense DevTools (dev-only)
    if (("TURBOPACK compile-time value", "development") !== 'production' && 'use' in _react.default) {
        const navigationPromises = (0, _react.use)(_hooksclientcontextsharedruntime.NavigationPromisesContext);
        if (navigationPromises) {
            return (0, _react.use)(navigationPromises.params);
        }
    }
    return params;
}
function useSelectedLayoutSegments(parallelRouteKey = 'children') {
    _navigationdynamicrendering.useDynamicRouteParams?.('useSelectedLayoutSegments()');
    const context = (0, _react.useContext)(_approutercontextsharedruntime.LayoutRouterContext);
    // @ts-expect-error This only happens in `pages`. Type is overwritten in navigation.d.ts
    if (!context) return null;
    // During build-time instant validation, error if fallback params exist
    // because useSelectedLayoutSegments() can't return a sensible value without all params.
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    // Instrument with Suspense DevTools (dev-only)
    if (("TURBOPACK compile-time value", "development") !== 'production' && 'use' in _react.default) {
        const navigationPromises = (0, _react.use)(_hooksclientcontextsharedruntime.NavigationPromisesContext);
        if (navigationPromises) {
            const promise = navigationPromises.selectedLayoutSegmentsPromises?.get(parallelRouteKey);
            if (promise) {
                // We should always have a promise here, but if we don't, it's not worth erroring over.
                // We just won't be able to instrument it, but can still provide the value.
                return (0, _react.use)(promise);
            }
        }
    }
    return (0, _segment.getSelectedLayoutSegmentPath)(context.parentTree, parallelRouteKey);
}
function useSelectedLayoutSegment(parallelRouteKey = 'children') {
    _navigationdynamicrendering.useDynamicRouteParams?.('useSelectedLayoutSegment()');
    const navigationPromises = (0, _react.useContext)(_hooksclientcontextsharedruntime.NavigationPromisesContext);
    const selectedLayoutSegments = useSelectedLayoutSegments(parallelRouteKey);
    // During build-time instant validation, error if fallback params exist
    // because useSelectedLayoutSegment() can't return a sensible value without all params.
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    // Instrument with Suspense DevTools (dev-only)
    if (("TURBOPACK compile-time value", "development") !== 'production' && navigationPromises && 'use' in _react.default) {
        const promise = navigationPromises.selectedLayoutSegmentPromises?.get(parallelRouteKey);
        if (promise) {
            // We should always have a promise here, but if we don't, it's not worth erroring over.
            // We just won't be able to instrument it, but can still provide the value.
            return (0, _react.use)(promise);
        }
    }
    return (0, _segment.computeSelectedLayoutSegment)(selectedLayoutSegments, parallelRouteKey);
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/navigation.react-server.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ReadonlyURLSearchParams: null,
    RedirectType: null,
    forbidden: null,
    notFound: null,
    permanentRedirect: null,
    redirect: null,
    unauthorized: null,
    unstable_isUnrecognizedActionError: null,
    unstable_rethrow: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    ReadonlyURLSearchParams: function() {
        return _readonlyurlsearchparams.ReadonlyURLSearchParams;
    },
    RedirectType: function() {
        return RedirectType;
    },
    forbidden: function() {
        return _forbidden.forbidden;
    },
    notFound: function() {
        return _notfound.notFound;
    },
    permanentRedirect: function() {
        return _redirect.permanentRedirect;
    },
    redirect: function() {
        return _redirect.redirect;
    },
    unauthorized: function() {
        return _unauthorized.unauthorized;
    },
    unstable_isUnrecognizedActionError: function() {
        return unstable_isUnrecognizedActionError;
    },
    unstable_rethrow: function() {
        return _unstablerethrow.unstable_rethrow;
    }
});
const _readonlyurlsearchparams = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/readonly-url-search-params.js [app-ssr] (ecmascript)");
const _redirect = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/redirect.js [app-ssr] (ecmascript)");
const _notfound = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/not-found.js [app-ssr] (ecmascript)");
const _forbidden = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/forbidden.js [app-ssr] (ecmascript)");
const _unauthorized = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/unauthorized.js [app-ssr] (ecmascript)");
const _unstablerethrow = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/unstable-rethrow.js [app-ssr] (ecmascript)");
function unstable_isUnrecognizedActionError() {
    throw new Error('`unstable_isUnrecognizedActionError` can only be used on the client.');
}
const RedirectType = {
    push: 'push',
    replace: 'replace'
};
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/not-found.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "notFound", {
    enumerable: true,
    get: function() {
        return notFound;
    }
});
const _httpaccessfallback = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/http-access-fallback/http-access-fallback.js [app-ssr] (ecmascript)");
/**
 * This function allows you to render the [not-found.js file](https://nextjs.org/docs/app/api-reference/file-conventions/not-found)
 * within a route segment as well as inject a tag.
 *
 * `notFound()` can be used in
 * [Server Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components),
 * [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers), and
 * [Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations).
 *
 * - In a Server Component, this will insert a `<meta name="robots" content="noindex" />` meta tag and set the status code to 404.
 * - In a Route Handler or Server Action, it will serve a 404 to the caller.
 *
 * Read more: [Next.js Docs: `notFound`](https://nextjs.org/docs/app/api-reference/functions/not-found)
 */ const DIGEST = `${_httpaccessfallback.HTTP_ERROR_FALLBACK_ERROR_CODE};404`;
function notFound() {
    const error = new Error(DIGEST);
    error.digest = DIGEST;
    throw error;
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/readonly-url-search-params.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

/**
 * ReadonlyURLSearchParams implementation shared between client and server.
 * This file is intentionally not marked as 'use client' or 'use server'
 * so it can be imported by both environments.
 */ /** @internal */ Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "ReadonlyURLSearchParams", {
    enumerable: true,
    get: function() {
        return ReadonlyURLSearchParams;
    }
});
class ReadonlyURLSearchParamsError extends Error {
    constructor(){
        super('Method unavailable on `ReadonlyURLSearchParams`. Read more: https://nextjs.org/docs/app/api-reference/functions/use-search-params#updating-searchparams');
    }
}
class ReadonlyURLSearchParams extends URLSearchParams {
    /** @deprecated Method unavailable on `ReadonlyURLSearchParams`. Read more: https://nextjs.org/docs/app/api-reference/functions/use-search-params#updating-searchparams */ append() {
        throw new ReadonlyURLSearchParamsError();
    }
    /** @deprecated Method unavailable on `ReadonlyURLSearchParams`. Read more: https://nextjs.org/docs/app/api-reference/functions/use-search-params#updating-searchparams */ delete() {
        throw new ReadonlyURLSearchParamsError();
    }
    /** @deprecated Method unavailable on `ReadonlyURLSearchParams`. Read more: https://nextjs.org/docs/app/api-reference/functions/use-search-params#updating-searchparams */ set() {
        throw new ReadonlyURLSearchParamsError();
    }
    /** @deprecated Method unavailable on `ReadonlyURLSearchParams`. Read more: https://nextjs.org/docs/app/api-reference/functions/use-search-params#updating-searchparams */ sort() {
        throw new ReadonlyURLSearchParamsError();
    }
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/redirect-error.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    REDIRECT_ERROR_CODE: null,
    isRedirectError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    REDIRECT_ERROR_CODE: function() {
        return REDIRECT_ERROR_CODE;
    },
    isRedirectError: function() {
        return isRedirectError;
    }
});
const _redirectstatuscode = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/redirect-status-code.js [app-ssr] (ecmascript)");
const REDIRECT_ERROR_CODE = 'NEXT_REDIRECT';
function isRedirectError(error) {
    if (typeof error !== 'object' || error === null || !('digest' in error) || typeof error.digest !== 'string') {
        return false;
    }
    const digest = error.digest.split(';');
    const [errorCode, type] = digest;
    const destination = digest.slice(2, -2).join(';');
    const status = digest.at(-2);
    const statusCode = Number(status);
    return errorCode === REDIRECT_ERROR_CODE && (type === 'replace' || type === 'push') && typeof destination === 'string' && !isNaN(statusCode) && statusCode in _redirectstatuscode.RedirectStatusCode;
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/redirect-status-code.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "RedirectStatusCode", {
    enumerable: true,
    get: function() {
        return RedirectStatusCode;
    }
});
var RedirectStatusCode = /*#__PURE__*/ function(RedirectStatusCode) {
    RedirectStatusCode[RedirectStatusCode["SeeOther"] = 303] = "SeeOther";
    RedirectStatusCode[RedirectStatusCode["TemporaryRedirect"] = 307] = "TemporaryRedirect";
    RedirectStatusCode[RedirectStatusCode["PermanentRedirect"] = 308] = "PermanentRedirect";
    return RedirectStatusCode;
}({});
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/redirect.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getRedirectError: null,
    getRedirectStatusCodeFromError: null,
    getRedirectTypeFromError: null,
    getURLFromRedirectError: null,
    permanentRedirect: null,
    redirect: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getRedirectError: function() {
        return getRedirectError;
    },
    getRedirectStatusCodeFromError: function() {
        return getRedirectStatusCodeFromError;
    },
    getRedirectTypeFromError: function() {
        return getRedirectTypeFromError;
    },
    getURLFromRedirectError: function() {
        return getURLFromRedirectError;
    },
    permanentRedirect: function() {
        return permanentRedirect;
    },
    redirect: function() {
        return redirect;
    }
});
const _redirectstatuscode = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/redirect-status-code.js [app-ssr] (ecmascript)");
const _redirecterror = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/redirect-error.js [app-ssr] (ecmascript)");
const _serverasyncstorage = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/server-async-storage.js [app-ssr] (ecmascript)");
function getRedirectError(url, type, statusCode = _redirectstatuscode.RedirectStatusCode.TemporaryRedirect) {
    const error = new Error(_redirecterror.REDIRECT_ERROR_CODE);
    error.digest = `${_redirecterror.REDIRECT_ERROR_CODE};${type};${url};${statusCode};`;
    return error;
}
function redirect(/** The URL to redirect to */ url, type) {
    type ??= _serverasyncstorage.actionAsyncStorage?.getStore()?.isAction ? 'push' : 'replace';
    throw getRedirectError(url, type, _redirectstatuscode.RedirectStatusCode.TemporaryRedirect);
}
function permanentRedirect(/** The URL to redirect to */ url, type = 'replace') {
    throw getRedirectError(url, type, _redirectstatuscode.RedirectStatusCode.PermanentRedirect);
}
function getURLFromRedirectError(error) {
    if (!(0, _redirecterror.isRedirectError)(error)) return null;
    // Slices off the beginning of the digest that contains the code and the
    // separating ';'.
    return error.digest.split(';').slice(2, -2).join(';');
}
function getRedirectTypeFromError(error) {
    if (!(0, _redirecterror.isRedirectError)(error)) {
        throw new Error('Not a redirect error');
    }
    return error.digest.split(';', 2)[1];
}
function getRedirectStatusCodeFromError(error) {
    if (!(0, _redirecterror.isRedirectError)(error)) {
        throw new Error('Not a redirect error');
    }
    return Number(error.digest.split(';').at(-2));
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/server-async-storage.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

// Client-safe access to the server-only async-storage singletons. On the
// server these re-export the real storages; in the browser bundle this module
// is aliased to `./server-async-storage.browser` (see
// scripts/generate-browser-variant-aliases.mjs), which exports `undefined`
// stubs so the AsyncLocalStorage modules are never bundled into the client.
// Consumers must guard usage so the stubs are not dereferenced in the browser.
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    actionAsyncStorage: null,
    workAsyncStorage: null,
    workUnitAsyncStorage: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    actionAsyncStorage: function() {
        return _actionasyncstorageexternal.actionAsyncStorage;
    },
    workAsyncStorage: function() {
        return _workasyncstorageexternal.workAsyncStorage;
    },
    workUnitAsyncStorage: function() {
        return _workunitasyncstorageexternal.workUnitAsyncStorage;
    }
});
const _actionasyncstorageexternal = __turbopack_context__.r("[externals]/next/dist/server/app-render/action-async-storage.external.js [external] (next/dist/server/app-render/action-async-storage.external.js, cjs)");
const _workasyncstorageexternal = __turbopack_context__.r("[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)");
const _workunitasyncstorageexternal = __turbopack_context__.r("[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)");
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/static-generation-bailout.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    StaticGenBailoutError: null,
    isStaticGenBailoutError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    StaticGenBailoutError: function() {
        return StaticGenBailoutError;
    },
    isStaticGenBailoutError: function() {
        return isStaticGenBailoutError;
    }
});
const NEXT_STATIC_GEN_BAILOUT = 'NEXT_STATIC_GEN_BAILOUT';
class StaticGenBailoutError extends Error {
    constructor(...args){
        super(...args), this.code = NEXT_STATIC_GEN_BAILOUT;
    }
}
function isStaticGenBailoutError(error) {
    if (typeof error !== 'object' || error === null || !('code' in error)) {
        return false;
    }
    return error.code === NEXT_STATIC_GEN_BAILOUT;
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/unauthorized.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "unauthorized", {
    enumerable: true,
    get: function() {
        return unauthorized;
    }
});
const _httpaccessfallback = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/http-access-fallback/http-access-fallback.js [app-ssr] (ecmascript)");
// TODO: Add `unauthorized` docs
/**
 * @experimental
 * This function allows you to render the [unauthorized.js file](https://nextjs.org/docs/app/api-reference/file-conventions/unauthorized)
 * within a route segment as well as inject a tag.
 *
 * `unauthorized()` can be used in
 * [Server Components](https://nextjs.org/docs/app/building-your-application/rendering/server-components),
 * [Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers), and
 * [Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations).
 *
 *
 * Read more: [Next.js Docs: `unauthorized`](https://nextjs.org/docs/app/api-reference/functions/unauthorized)
 */ const DIGEST = `${_httpaccessfallback.HTTP_ERROR_FALLBACK_ERROR_CODE};401`;
function unauthorized() {
    if ("TURBOPACK compile-time truthy", 1) {
        throw new Error(`\`unauthorized()\` is experimental and only allowed to be used when \`experimental.authInterrupts\` is enabled.`);
    }
    const error = new Error(DIGEST);
    error.digest = DIGEST;
    throw error;
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/unrecognized-action-error.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    UnrecognizedActionError: null,
    unstable_isUnrecognizedActionError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    UnrecognizedActionError: function() {
        return UnrecognizedActionError;
    },
    unstable_isUnrecognizedActionError: function() {
        return unstable_isUnrecognizedActionError;
    }
});
class UnrecognizedActionError extends Error {
    constructor(...args){
        super(...args);
        this.name = 'UnrecognizedActionError';
    }
}
function unstable_isUnrecognizedActionError(error) {
    return !!(error && typeof error === 'object' && error instanceof UnrecognizedActionError);
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/unstable-rethrow.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "unstable_rethrow", {
    enumerable: true,
    get: function() {
        return unstable_rethrow;
    }
});
const _dynamicrenderingutils = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/dynamic-rendering-utils.js [app-ssr] (ecmascript)");
const _bailouttocsr = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/lazy-dynamic/bailout-to-csr.js [app-ssr] (ecmascript)");
const _isnextroutererror = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/is-next-router-error.js [app-ssr] (ecmascript)");
const _dynamicrendering = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/app-render/dynamic-rendering.js [app-ssr] (ecmascript)");
const _hooksservercontext = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/hooks-server-context.js [app-ssr] (ecmascript)");
function unstable_rethrow(error) {
    if ((0, _isnextroutererror.isNextRouterError)(error) || (0, _bailouttocsr.isBailoutToCSRError)(error) || (0, _hooksservercontext.isDynamicServerError)(error) || (0, _dynamicrenderingutils.isHangingPromiseRejectionError)(error) || (0, _dynamicrendering.isPrerenderInterruptedError)(error)) {
        throw error;
    }
    if (error instanceof Error && 'cause' in error) {
        unstable_rethrow(error.cause);
    }
}
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/compiled/@edge-runtime/cookies/index.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all)=>{
    for(var name in all)__defProp(target, name, {
        get: all[name],
        enumerable: true
    });
};
var __copyProps = (to, from, except, desc)=>{
    if (from && typeof from === "object" || typeof from === "function") {
        for (let key of __getOwnPropNames(from))if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
            get: ()=>from[key],
            enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
    }
    return to;
};
var __toCommonJS = (mod)=>__copyProps(__defProp({}, "__esModule", {
        value: true
    }), mod);
// src/index.ts
var src_exports = {};
__export(src_exports, {
    RequestCookies: ()=>RequestCookies,
    ResponseCookies: ()=>ResponseCookies,
    parseCookie: ()=>parseCookie,
    parseSetCookie: ()=>parseSetCookie,
    stringifyCookie: ()=>stringifyCookie
});
module.exports = __toCommonJS(src_exports);
// src/serialize.ts
function stringifyCookie(c) {
    var _a;
    const attrs = [
        "path" in c && c.path && `Path=${c.path}`,
        "expires" in c && (c.expires || c.expires === 0) && `Expires=${(typeof c.expires === "number" ? new Date(c.expires) : c.expires).toUTCString()}`,
        "maxAge" in c && typeof c.maxAge === "number" && `Max-Age=${c.maxAge}`,
        "domain" in c && c.domain && `Domain=${c.domain}`,
        "secure" in c && c.secure && "Secure",
        "httpOnly" in c && c.httpOnly && "HttpOnly",
        "sameSite" in c && c.sameSite && `SameSite=${c.sameSite}`,
        "partitioned" in c && c.partitioned && "Partitioned",
        "priority" in c && c.priority && `Priority=${c.priority}`
    ].filter(Boolean);
    const stringified = `${c.name}=${encodeURIComponent((_a = c.value) != null ? _a : "")}`;
    return attrs.length === 0 ? stringified : `${stringified}; ${attrs.join("; ")}`;
}
function parseCookie(cookie) {
    const map = /* @__PURE__ */ new Map();
    for (const pair of cookie.split(/; */)){
        if (!pair) continue;
        const splitAt = pair.indexOf("=");
        if (splitAt === -1) {
            map.set(pair, "true");
            continue;
        }
        const [key, value] = [
            pair.slice(0, splitAt),
            pair.slice(splitAt + 1)
        ];
        try {
            map.set(key, decodeURIComponent(value != null ? value : "true"));
        } catch  {}
    }
    return map;
}
function parseSetCookie(setCookie) {
    if (!setCookie) {
        return void 0;
    }
    const [[name, value], ...attributes] = parseCookie(setCookie);
    const { domain, expires, httponly, maxage, path, samesite, secure, partitioned, priority } = Object.fromEntries(attributes.map(([key, value2])=>[
            key.toLowerCase().replace(/-/g, ""),
            value2
        ]));
    const cookie = {
        name,
        value: decodeURIComponent(value),
        domain,
        ...expires && {
            expires: new Date(expires)
        },
        ...httponly && {
            httpOnly: true
        },
        ...typeof maxage === "string" && {
            maxAge: Number(maxage)
        },
        path,
        ...samesite && {
            sameSite: parseSameSite(samesite)
        },
        ...secure && {
            secure: true
        },
        ...priority && {
            priority: parsePriority(priority)
        },
        ...partitioned && {
            partitioned: true
        }
    };
    return compact(cookie);
}
function compact(t) {
    const newT = {};
    for(const key in t){
        if (t[key]) {
            newT[key] = t[key];
        }
    }
    return newT;
}
var SAME_SITE = [
    "strict",
    "lax",
    "none"
];
function parseSameSite(string) {
    string = string.toLowerCase();
    return SAME_SITE.includes(string) ? string : void 0;
}
var PRIORITY = [
    "low",
    "medium",
    "high"
];
function parsePriority(string) {
    string = string.toLowerCase();
    return PRIORITY.includes(string) ? string : void 0;
}
function splitCookiesString(cookiesString) {
    if (!cookiesString) return [];
    var cookiesStrings = [];
    var pos = 0;
    var start;
    var ch;
    var lastComma;
    var nextStart;
    var cookiesSeparatorFound;
    function skipWhitespace() {
        while(pos < cookiesString.length && /\s/.test(cookiesString.charAt(pos))){
            pos += 1;
        }
        return pos < cookiesString.length;
    }
    function notSpecialChar() {
        ch = cookiesString.charAt(pos);
        return ch !== "=" && ch !== ";" && ch !== ",";
    }
    while(pos < cookiesString.length){
        start = pos;
        cookiesSeparatorFound = false;
        while(skipWhitespace()){
            ch = cookiesString.charAt(pos);
            if (ch === ",") {
                lastComma = pos;
                pos += 1;
                skipWhitespace();
                nextStart = pos;
                while(pos < cookiesString.length && notSpecialChar()){
                    pos += 1;
                }
                if (pos < cookiesString.length && cookiesString.charAt(pos) === "=") {
                    cookiesSeparatorFound = true;
                    pos = nextStart;
                    cookiesStrings.push(cookiesString.substring(start, lastComma));
                    start = pos;
                } else {
                    pos = lastComma + 1;
                }
            } else {
                pos += 1;
            }
        }
        if (!cookiesSeparatorFound || pos >= cookiesString.length) {
            cookiesStrings.push(cookiesString.substring(start, cookiesString.length));
        }
    }
    return cookiesStrings;
}
// src/request-cookies.ts
var RequestCookies = class {
    constructor(requestHeaders){
        /** @internal */ this._parsed = /* @__PURE__ */ new Map();
        this._headers = requestHeaders;
        const header = requestHeaders.get("cookie");
        if (header) {
            const parsed = parseCookie(header);
            for (const [name, value] of parsed){
                this._parsed.set(name, {
                    name,
                    value
                });
            }
        }
    }
    [Symbol.iterator]() {
        return this._parsed[Symbol.iterator]();
    }
    /**
   * The amount of cookies received from the client
   */ get size() {
        return this._parsed.size;
    }
    get(...args) {
        const name = typeof args[0] === "string" ? args[0] : args[0].name;
        return this._parsed.get(name);
    }
    getAll(...args) {
        var _a;
        const all = Array.from(this._parsed);
        if (!args.length) {
            return all.map(([_, value])=>value);
        }
        const name = typeof args[0] === "string" ? args[0] : (_a = args[0]) == null ? void 0 : _a.name;
        return all.filter(([n])=>n === name).map(([_, value])=>value);
    }
    has(name) {
        return this._parsed.has(name);
    }
    set(...args) {
        const [name, value] = args.length === 1 ? [
            args[0].name,
            args[0].value
        ] : args;
        const map = this._parsed;
        map.set(name, {
            name,
            value
        });
        this._headers.set("cookie", Array.from(map).map(([_, value2])=>stringifyCookie(value2)).join("; "));
        return this;
    }
    /**
   * Delete the cookies matching the passed name or names in the request.
   */ delete(names) {
        const map = this._parsed;
        const result = !Array.isArray(names) ? map.delete(names) : names.map((name)=>map.delete(name));
        this._headers.set("cookie", Array.from(map).map(([_, value])=>stringifyCookie(value)).join("; "));
        return result;
    }
    /**
   * Delete all the cookies in the cookies in the request.
   */ clear() {
        this.delete(Array.from(this._parsed.keys()));
        return this;
    }
    /**
   * Format the cookies in the request as a string for logging
   */ [Symbol.for("edge-runtime.inspect.custom")]() {
        return `RequestCookies ${JSON.stringify(Object.fromEntries(this._parsed))}`;
    }
    toString() {
        return [
            ...this._parsed.values()
        ].map((v)=>`${v.name}=${encodeURIComponent(v.value)}`).join("; ");
    }
};
// src/response-cookies.ts
var ResponseCookies = class {
    constructor(responseHeaders){
        /** @internal */ this._parsed = /* @__PURE__ */ new Map();
        var _a, _b, _c;
        this._headers = responseHeaders;
        const setCookie = (_c = (_b = (_a = responseHeaders.getSetCookie) == null ? void 0 : _a.call(responseHeaders)) != null ? _b : responseHeaders.get("set-cookie")) != null ? _c : [];
        const cookieStrings = Array.isArray(setCookie) ? setCookie : splitCookiesString(setCookie);
        for (const cookieString of cookieStrings){
            const parsed = parseSetCookie(cookieString);
            if (parsed) this._parsed.set(parsed.name, parsed);
        }
    }
    /**
   * {@link https://wicg.github.io/cookie-store/#CookieStore-get CookieStore#get} without the Promise.
   */ get(...args) {
        const key = typeof args[0] === "string" ? args[0] : args[0].name;
        return this._parsed.get(key);
    }
    /**
   * {@link https://wicg.github.io/cookie-store/#CookieStore-getAll CookieStore#getAll} without the Promise.
   */ getAll(...args) {
        var _a;
        const all = Array.from(this._parsed.values());
        if (!args.length) {
            return all;
        }
        const key = typeof args[0] === "string" ? args[0] : (_a = args[0]) == null ? void 0 : _a.name;
        return all.filter((c)=>c.name === key);
    }
    has(name) {
        return this._parsed.has(name);
    }
    /**
   * {@link https://wicg.github.io/cookie-store/#CookieStore-set CookieStore#set} without the Promise.
   */ set(...args) {
        const [name, value, cookie] = args.length === 1 ? [
            args[0].name,
            args[0].value,
            args[0]
        ] : args;
        const map = this._parsed;
        map.set(name, normalizeCookie({
            name,
            value,
            ...cookie
        }));
        replace(map, this._headers);
        return this;
    }
    /**
   * {@link https://wicg.github.io/cookie-store/#CookieStore-delete CookieStore#delete} without the Promise.
   */ delete(...args) {
        const [name, options] = typeof args[0] === "string" ? [
            args[0]
        ] : [
            args[0].name,
            args[0]
        ];
        return this.set({
            ...options,
            name,
            value: "",
            expires: /* @__PURE__ */ new Date(0)
        });
    }
    [Symbol.for("edge-runtime.inspect.custom")]() {
        return `ResponseCookies ${JSON.stringify(Object.fromEntries(this._parsed))}`;
    }
    toString() {
        return [
            ...this._parsed.values()
        ].map(stringifyCookie).join("; ");
    }
};
function replace(bag, headers) {
    headers.delete("set-cookie");
    for (const [, value] of bag){
        const serialized = stringifyCookie(value);
        headers.append("set-cookie", serialized);
    }
}
function normalizeCookie(cookie = {
    name: "",
    value: ""
}) {
    if (typeof cookie.expires === "number") {
        cookie.expires = new Date(cookie.expires);
    }
    if (cookie.maxAge) {
        cookie.expires = new Date(Date.now() + cookie.maxAge * 1e3);
    }
    if (cookie.path === null || cookie.path === void 0) {
        cookie.path = "/";
    }
    return cookie;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
    RequestCookies,
    ResponseCookies,
    parseCookie,
    parseSetCookie,
    stringifyCookie
});
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/lib/scheduler.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    atLeastOneTask: null,
    scheduleImmediate: null,
    scheduleOnNextTick: null,
    waitAtLeastOneReactRenderTask: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    atLeastOneTask: function() {
        return atLeastOneTask;
    },
    scheduleImmediate: function() {
        return scheduleImmediate;
    },
    scheduleOnNextTick: function() {
        return scheduleOnNextTick;
    },
    waitAtLeastOneReactRenderTask: function() {
        return waitAtLeastOneReactRenderTask;
    }
});
const scheduleOnNextTick = (cb)=>{
    // We use Promise.resolve().then() here so that the operation is scheduled at
    // the end of the promise job queue, we then add it to the next process tick
    // to ensure it's evaluated afterwards.
    //
    // This was inspired by the implementation of the DataLoader interface: https://github.com/graphql/dataloader/blob/d336bd15282664e0be4b4a657cb796f09bafbc6b/src/index.js#L213-L255
    //
    Promise.resolve().then(()=>{
        if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
        ;
        else {
            process.nextTick(cb);
        }
    });
};
const scheduleImmediate = (cb)=>{
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    else {
        setImmediate(cb);
    }
};
function atLeastOneTask() {
    return new Promise((resolve)=>scheduleImmediate(resolve));
}
function waitAtLeastOneReactRenderTask() {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    else {
        return new Promise((r)=>setImmediate(r));
    }
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/next-devtools/dev-overlay.shim.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    dispatcher: null,
    renderAppDevOverlay: null,
    renderPagesDevOverlay: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    dispatcher: function() {
        return dispatcher;
    },
    renderAppDevOverlay: function() {
        return renderAppDevOverlay;
    },
    renderPagesDevOverlay: function() {
        return renderPagesDevOverlay;
    }
});
function renderAppDevOverlay() {
    throw new Error("Next DevTools: Can't render in this environment. This is a bug in Next.js");
}
function renderPagesDevOverlay() {
    throw new Error("Next DevTools: Can't render in this environment. This is a bug in Next.js");
}
const dispatcher = new Proxy({}, {
    get: (_, prop)=>{
        return ()=>{
            throw new Error(`Next DevTools: Can't dispatch ${String(prop)} in this environment. This is a bug in Next.js`);
        };
    }
});
if ((typeof exports.default === 'function' || typeof exports.default === 'object' && exports.default !== null) && typeof exports.default.__esModule === 'undefined') {
    Object.defineProperty(exports.default, '__esModule', {
        value: true
    });
    Object.assign(exports.default, exports);
    module.exports = exports.default;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/app-render/dynamic-rendering-client.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    useDynamicRouteParams: null,
    useDynamicSearchParams: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    useDynamicRouteParams: function() {
        return useDynamicRouteParams;
    },
    useDynamicSearchParams: function() {
        return useDynamicSearchParams;
    }
});
const _react = /*#__PURE__*/ _interop_require_default(__turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)"));
const _reactdom = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-dom.js [app-ssr] (ecmascript)");
const _workunitasyncstorageexternal = __turbopack_context__.r("[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)");
const _workasyncstorageexternal = __turbopack_context__.r("[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)");
const _dynamicrenderingutils = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/dynamic-rendering-utils.js [app-ssr] (ecmascript)");
const _invarianterror = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/invariant-error.js [app-ssr] (ecmascript)");
const _bailouttocsr = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/lazy-dynamic/bailout-to-csr.js [app-ssr] (ecmascript)");
const _reactbrowserbailout = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/lazy-dynamic/react-browser-bailout.js [app-ssr] (ecmascript)");
function _interop_require_default(obj) {
    return obj && obj.__esModule ? obj : {
        default: obj
    };
}
const getUseSearchParamsBailoutReason = _reactbrowserbailout.createReactBrowserBailoutReason.bind(null, 'useSearchParams()');
function useDynamicRouteParams(expression) {
    const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
    const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
    if (workStore && workUnitStore) {
        switch(workUnitStore.type){
            case 'prerender-client':
                {
                    const fallbackParams = workUnitStore.fallbackRouteParams;
                    if (fallbackParams && fallbackParams.size > 0) {
                        // We are in a prerender with cacheComponents semantics. We are going to
                        // hang here and never resolve. This will cause the currently
                        // rendering component to effectively be a dynamic hole.
                        _react.default.use((0, _dynamicrenderingutils.makeClientHookHangingPromise)(workUnitStore.renderSignal, new _dynamicrenderingutils.ClientHookDynamicError(workStore.route, expression)));
                    }
                    break;
                }
            case 'prerender':
                throw new _invarianterror.InvariantError(`\`${expression}\` was called from a Server Component. Next.js should be preventing ${expression} from being included in server components statically, but did not in this case.`);
            case 'validation-client':
                {
                    break;
                }
            case 'prerender-runtime':
                throw new _invarianterror.InvariantError(`\`${expression}\` was called during a runtime prerender. Next.js should be preventing ${expression} from being included in server components statically, but did not in this case.`);
            case 'cache':
            case 'private-cache':
                throw new _invarianterror.InvariantError(`\`${expression}\` was called inside a cache scope. Next.js should be preventing ${expression} from being included in server components statically, but did not in this case.`);
            case 'build-time-generator':
                throw new _invarianterror.InvariantError(`\`${expression}\` was called in \`${workUnitStore.functionName}\`. Next.js should be preventing ${expression} from being included in server component files statically, but did not in this case.`);
            case 'prerender-legacy':
            case 'request':
            case 'unstable-cache':
                break;
            default:
                workUnitStore;
        }
    }
}
function useDynamicSearchParams(expression) {
    const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
    const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
    if (!workStore) {
        // We assume pages router context and just return
        return;
    }
    if (!workUnitStore) {
        (0, _workunitasyncstorageexternal.throwForMissingRequestStore)(expression);
    }
    switch(workUnitStore.type){
        case 'validation-client':
            // During instant validation we try to behave as close to client as possible,
            // so this shouldn't hang during SSR.
            return;
        case 'prerender-client':
            {
                _react.default.use((0, _dynamicrenderingutils.makeClientHookHangingPromise)(workUnitStore.renderSignal, new _dynamicrenderingutils.ClientHookDynamicError(workStore.route, expression)));
                break;
            }
        case 'prerender-legacy':
            {
                if (workStore.forceStatic) {
                    return;
                }
                if ("TURBOPACK compile-time truthy", 1) {
                    // @ts-expect-error TODO: Update @types/react-dom to include the reason argument.
                    _react.default.use((0, _reactdom.browser)(getUseSearchParamsBailoutReason));
                    return;
                } else //TURBOPACK unreachable
                ;
            }
        case 'prerender':
        case 'prerender-runtime':
            throw new _invarianterror.InvariantError(`\`${expression}\` was called from a Server Component. Next.js should be preventing ${expression} from being included in server components statically, but did not in this case.`);
        case 'cache':
        case 'unstable-cache':
        case 'private-cache':
            throw new _invarianterror.InvariantError(`\`${expression}\` was called inside a cache scope. Next.js should be preventing ${expression} from being included in server components statically, but did not in this case.`);
        case 'build-time-generator':
            throw new _invarianterror.InvariantError(`\`${expression}\` was called in \`${workUnitStore.functionName}\`. Next.js should be preventing ${expression} from being included in server component files statically, but did not in this case.`);
        case 'request':
            return;
        default:
            workUnitStore;
    }
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/app-render/dynamic-rendering.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

/**
 * The functions provided by this module are used to communicate certain properties
 * about the currently running code so that Next.js can make decisions on how to handle
 * the current execution in different rendering modes such as pre-rendering, resuming, and SSR.
 *
 * Today Next.js treats all code as potentially static. Certain APIs may only make sense when dynamically rendering.
 * Traditionally this meant deopting the entire render to dynamic however with PPR we can now deopt parts
 * of a React tree as dynamic while still keeping other parts static. There are really two different kinds of
 * Dynamic indications.
 *
 * The first is simply an intention to be dynamic. unstable_noStore is an example of this where
 * the currently executing code simply declares that the current scope is dynamic but if you use it
 * inside unstable_cache it can still be cached. This type of indication can be removed if we ever
 * make the default dynamic to begin with because the only way you would ever be static is inside
 * a cache scope which this indication does not affect.
 *
 * The second is an indication that a dynamic data source was read. This is a stronger form of dynamic
 * because it means that it is inappropriate to cache this at all. using a dynamic data source inside
 * unstable_cache should error. If you want to use some dynamic data inside unstable_cache you should
 * read that data outside the cache and pass it in as an argument to the cached function.
 */ Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    abortAndThrowOnSynchronousRequestDataAccess: null,
    abortOnSynchronousPlatformIOAccess: null,
    accessedDynamicData: null,
    annotateDynamicAccess: null,
    consumeDynamicAccess: null,
    createDynamicTrackingState: null,
    createHangingInputAbortSignal: null,
    formatDynamicAPIAccesses: null,
    getFirstDynamicReason: null,
    isPrerenderInterruptedError: null,
    markCurrentScopeAsDynamic: null,
    throwToInterruptStaticGeneration: null,
    trackDynamicDataInDynamicRender: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    abortAndThrowOnSynchronousRequestDataAccess: function() {
        return abortAndThrowOnSynchronousRequestDataAccess;
    },
    abortOnSynchronousPlatformIOAccess: function() {
        return abortOnSynchronousPlatformIOAccess;
    },
    accessedDynamicData: function() {
        return accessedDynamicData;
    },
    annotateDynamicAccess: function() {
        return annotateDynamicAccess;
    },
    consumeDynamicAccess: function() {
        return consumeDynamicAccess;
    },
    createDynamicTrackingState: function() {
        return createDynamicTrackingState;
    },
    createHangingInputAbortSignal: function() {
        return createHangingInputAbortSignal;
    },
    formatDynamicAPIAccesses: function() {
        return formatDynamicAPIAccesses;
    },
    getFirstDynamicReason: function() {
        return getFirstDynamicReason;
    },
    isPrerenderInterruptedError: function() {
        return isPrerenderInterruptedError;
    },
    markCurrentScopeAsDynamic: function() {
        return markCurrentScopeAsDynamic;
    },
    throwToInterruptStaticGeneration: function() {
        return throwToInterruptStaticGeneration;
    },
    trackDynamicDataInDynamicRender: function() {
        return trackDynamicDataInDynamicRender;
    }
});
const _hooksservercontext = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/hooks-server-context.js [app-ssr] (ecmascript)");
const _staticgenerationbailout = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/client/components/static-generation-bailout.js [app-ssr] (ecmascript)");
const _workunitasyncstorageexternal = __turbopack_context__.r("[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)");
const _scheduler = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/lib/scheduler.js [app-ssr] (ecmascript)");
function createDynamicTrackingState(isDebugDynamicAccesses) {
    return {
        isDebugDynamicAccesses,
        dynamicAccesses: [],
        syncDynamicErrorWithStack: null,
        syncDynamicErrorWithStackPostMicrotask: false
    };
}
function getFirstDynamicReason(trackingState) {
    var _trackingState_dynamicAccesses_;
    return (_trackingState_dynamicAccesses_ = trackingState.dynamicAccesses[0]) == null ? void 0 : _trackingState_dynamicAccesses_.expression;
}
function markCurrentScopeAsDynamic(store, workUnitStore, expression) {
    if (workUnitStore) {
        switch(workUnitStore.type){
            case 'cache':
            case 'unstable-cache':
                // Inside cache scopes, marking a scope as dynamic has no effect,
                // because the outer cache scope creates a cache boundary. This is
                // subtly different from reading a dynamic data source, which is
                // forbidden inside a cache scope.
                return;
            case 'private-cache':
                // A private cache scope is already dynamic by definition.
                return;
            case 'prerender-legacy':
            case 'request':
            case 'build-time-generator':
                break;
            default:
                workUnitStore;
        }
    }
    // If we're forcing dynamic rendering or we're forcing static rendering, we
    // don't need to do anything here because the entire page is already dynamic
    // or it's static and it should not throw or postpone here.
    if (store.forceDynamic || store.forceStatic) return;
    if (store.dynamicShouldError) {
        throw new _staticgenerationbailout.StaticGenBailoutError(`Route ${store.route} with \`dynamic = "error"\` couldn't be rendered statically because it used \`${expression}\`. See more info here: https://nextjs.org/docs/app/building-your-application/rendering/static-and-dynamic#dynamic-rendering`);
    }
    if (workUnitStore) {
        switch(workUnitStore.type){
            case 'prerender-legacy':
                workUnitStore.revalidate = 0;
                // We aren't prerendering, but we are generating a static page. We need
                // to bail out of static generation.
                const err = new _hooksservercontext.DynamicServerError(`Route ${store.route} couldn't be rendered statically because it used ${expression}. See more info here: https://nextjs.org/docs/messages/dynamic-server-error`);
                store.dynamicUsageDescription = expression;
                store.dynamicUsageStack = err.stack;
                throw err;
            case 'request':
                markRequestStoreAsDynamic(workUnitStore);
                break;
            case 'build-time-generator':
                break;
            default:
                workUnitStore;
        }
    }
}
function throwToInterruptStaticGeneration(expression, store, prerenderStore) {
    // We aren't prerendering but we are generating a static page. We need to bail out of static generation
    const err = new _hooksservercontext.DynamicServerError(`Route ${store.route} couldn't be rendered statically because it used \`${expression}\`. See more info here: https://nextjs.org/docs/messages/dynamic-server-error`);
    prerenderStore.revalidate = 0;
    store.dynamicUsageDescription = expression;
    store.dynamicUsageStack = err.stack;
    throw err;
}
function trackDynamicDataInDynamicRender(workUnitStore) {
    switch(workUnitStore.type){
        case 'cache':
        case 'unstable-cache':
            // Inside cache scopes, marking a scope as dynamic has no effect,
            // because the outer cache scope creates a cache boundary. This is
            // subtly different from reading a dynamic data source, which is
            // forbidden inside a cache scope.
            return;
        case 'private-cache':
            // A private cache scope is already dynamic by definition.
            return;
        case 'prerender':
        case 'prerender-runtime':
        case 'prerender-legacy':
        case 'prerender-client':
        case 'validation-client':
        case 'build-time-generator':
            break;
        case 'request':
            markRequestStoreAsDynamic(workUnitStore);
            break;
        default:
            workUnitStore;
    }
}
function markRequestStoreAsDynamic(requestStore) {
    if (("TURBOPACK compile-time value", "1") && requestStore.phase === 'render') {
        requestStore.usedDynamic = true;
    }
}
function abortOnSynchronousDynamicDataAccess(route, expression, prerenderStore) {
    const reason = `Route ${route} needs to bail out of prerendering at this point because it used ${expression}.`;
    const error = createPrerenderInterruptedError(reason);
    prerenderStore.controller.abort(error);
    const dynamicTracking = prerenderStore.dynamicTracking;
    if (dynamicTracking) {
        dynamicTracking.dynamicAccesses.push({
            // When we aren't debugging, we don't need to create another error for the
            // stack trace.
            stack: dynamicTracking.isDebugDynamicAccesses ? new Error().stack : undefined,
            expression
        });
    }
}
function abortOnSynchronousPlatformIOAccess(route, expression, errorWithStack, prerenderStore) {
    const dynamicTracking = prerenderStore.dynamicTracking;
    if (dynamicTracking && dynamicTracking.syncDynamicErrorWithStack === null) {
        dynamicTracking.syncDynamicErrorWithStack = errorWithStack;
        // React completes the task that is currently rendering before scheduled
        // abort cleanup. Client tracking can attribute the sync IO only during
        // that current task; server tracking keeps the error regardless.
        queueMicrotask(()=>{
            dynamicTracking.syncDynamicErrorWithStackPostMicrotask = true;
        });
    }
    abortOnSynchronousDynamicDataAccess(route, expression, prerenderStore);
}
function abortAndThrowOnSynchronousRequestDataAccess(route, expression, errorWithStack, prerenderStore) {
    const prerenderSignal = prerenderStore.controller.signal;
    if (prerenderSignal.aborted === false) {
        // TODO it would be better to move this aborted check into the callsite so we can avoid making
        // the error object when it isn't relevant to the aborting of the prerender however
        // since we need the throw semantics regardless of whether we abort it is easier to land
        // this way. See how this was handled with `abortOnSynchronousPlatformIOAccess` for a closer
        // to ideal implementation
        abortOnSynchronousDynamicDataAccess(route, expression, prerenderStore);
        // Preserve the exact server-side dynamic access for final validation after
        // interrupting this render.
        const dynamicTracking = prerenderStore.dynamicTracking;
        if (dynamicTracking) {
            if (dynamicTracking.syncDynamicErrorWithStack === null) {
                dynamicTracking.syncDynamicErrorWithStack = errorWithStack;
            }
        }
    }
    throw createPrerenderInterruptedError(`Route ${route} needs to bail out of prerendering at this point because it used ${expression}.`);
}
const NEXT_PRERENDER_INTERRUPTED = 'NEXT_PRERENDER_INTERRUPTED';
function createPrerenderInterruptedError(message) {
    const error = new Error(message);
    error.digest = NEXT_PRERENDER_INTERRUPTED;
    return error;
}
function isPrerenderInterruptedError(error) {
    return typeof error === 'object' && error !== null && error.digest === NEXT_PRERENDER_INTERRUPTED && 'name' in error && 'message' in error && error instanceof Error;
}
function accessedDynamicData(dynamicAccesses) {
    return dynamicAccesses.length > 0;
}
function consumeDynamicAccess(serverDynamic, clientDynamic) {
    // We mutate because we only call this once we are no longer writing
    // to the dynamicTrackingState and it's more efficient than creating a new
    // array.
    serverDynamic.dynamicAccesses.push(...clientDynamic.dynamicAccesses);
    return serverDynamic.dynamicAccesses;
}
function formatDynamicAPIAccesses(dynamicAccesses) {
    return dynamicAccesses.filter((access)=>typeof access.stack === 'string' && access.stack.length > 0).map(({ expression, stack })=>{
        stack = stack.split('\n') // Remove the "Error: " prefix from the first line of the stack trace as
        // well as the first 4 lines of the stack trace which is the distance
        // from the user code and the `new Error().stack` call.
        .slice(4).filter((line)=>{
            // Exclude Next.js internals from the stack trace.
            if (line.includes('node_modules/next/')) {
                return false;
            }
            // Exclude anonymous functions from the stack trace.
            if (line.includes(' (<anonymous>)')) {
                return false;
            }
            // Exclude Node.js internals from the stack trace.
            if (line.includes(' (node:')) {
                return false;
            }
            return true;
        }).join('\n');
        return `Dynamic API Usage Debug - ${expression}:\n${stack}`;
    });
}
function createHangingInputAbortSignal(workUnitStore) {
    switch(workUnitStore.type){
        case 'prerender':
        case 'prerender-runtime':
            const controller = new AbortController();
            if (workUnitStore.cacheSignal) {
                // If we have a cacheSignal it means we're in a prospective render. If
                // the input we're waiting on is coming from another cache, we do want
                // to wait for it so that we can resolve this cache entry too.
                workUnitStore.cacheSignal.inputReady().then(()=>{
                    controller.abort();
                });
            } else {
                // Otherwise we're in the final render and we should already have all
                // our caches filled.
                // If the prerender uses stages, we have wait until the final stage.
                // if an input didn't resolve at that point, then we can assume it never will.
                //
                // We might still be waiting on some microtasks so we
                // wait one tick before giving up. When we give up, we still want to
                // render the content of this cache as deeply as we can so that we can
                // suspend as deeply as possible in the tree or not at all if we don't
                // end up waiting for the input.
                const stagedRendering = (0, _workunitasyncstorageexternal.getStagedRenderingController)(workUnitStore);
                if (stagedRendering && stagedRendering.finalStage !== null) {
                    stagedRendering.waitForStage(stagedRendering.finalStage).then(()=>(0, _scheduler.scheduleOnNextTick)(()=>controller.abort()), noop);
                } else {
                    (0, _scheduler.scheduleOnNextTick)(()=>controller.abort());
                }
            }
            return controller.signal;
        case 'prerender-client':
        case 'validation-client':
        case 'prerender-legacy':
        case 'request':
        case 'cache':
        case 'private-cache':
        case 'unstable-cache':
        case 'build-time-generator':
            return undefined;
        default:
            workUnitStore;
    }
}
function noop() {}
function annotateDynamicAccess(expression, prerenderStore) {
    const dynamicTracking = prerenderStore.dynamicTracking;
    if (dynamicTracking) {
        dynamicTracking.dynamicAccesses.push({
            stack: dynamicTracking.isDebugDynamicAccesses ? new Error().stack : undefined,
            expression
        });
    }
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/app-render/segment-config/ensure-static.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    EnsureStaticLevel: null,
    resolveEnsureStaticConfig: null,
    resolveEnsureStaticLevel: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    EnsureStaticLevel: function() {
        return EnsureStaticLevel;
    },
    resolveEnsureStaticConfig: function() {
        return resolveEnsureStaticConfig;
    },
    resolveEnsureStaticLevel: function() {
        return resolveEnsureStaticLevel;
    }
});
const _parseloadertree = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/router/utils/parse-loader-tree.js [app-ssr] (ecmascript)");
const _appdirmodule = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/lib/app-dir-module.js [app-ssr] (ecmascript)");
var EnsureStaticLevel = /*#__PURE__*/ function(EnsureStaticLevel) {
    /** The route follows standard Partial Prefetching semantics. */ EnsureStaticLevel[EnsureStaticLevel["None"] = 0] = "None";
    /** The route requires that app shells must be statically prerendered. */ EnsureStaticLevel[EnsureStaticLevel["Shell"] = 1] = "Shell";
    /** The route requires that app shells and prefetches must be statically prerendered. */ EnsureStaticLevel[EnsureStaticLevel["Prefetch"] = 2] = "Prefetch";
    /** The route requires that app shells, prefetches, and the whole page must be statically prerendered. */ EnsureStaticLevel[EnsureStaticLevel["Navigation"] = 3] = "Navigation";
    return EnsureStaticLevel;
}({});
function getEnsureStaticLevel(ensureStatic) {
    switch(ensureStatic){
        case 'auto':
        case false:
            {
                return 0;
            }
        case 'shell':
            {
                return 1;
            }
        case 'prefetch':
            {
                return 2;
            }
        case 'navigation':
            {
                return 3;
            }
    }
}
async function resolveEnsureStaticLevel(tree, partialPrefetching) {
    return getEnsureStaticLevel(await resolveEnsureStaticConfig(tree, partialPrefetching));
}
async function resolveEnsureStaticConfig(tree, partialPrefetching) {
    let { config, filePath } = await resolveEnsureStaticConfigImpl(tree);
    if (!partialPrefetching) {
        // If Partial Prefetching is not enabled for this route, we only support
        // a subset of `ensureStatic` values.
        // (We error in `getAppPageStaticInfo` if `ensureStatic` is used without enabling
        // Cache Components, so we don't have to assert that here)
        switch(config){
            case 'auto':
                {
                    // Default to the equivalent of Cache Components prefetching behavior.
                    config = 'prefetch';
                    break;
                }
            case false:
            case 'shell':
                {
                    // Not meaningful in Cache Components without Partial Prefetching
                    const originalConfig = config;
                    config = 'prefetch';
                    console.warn(`${formatEnsureStaticExport(originalConfig)} has no effect unless the route is using Partial Prefetching.` + `\n  (from: ${filePath})`);
                    break;
                }
            case 'prefetch':
                break;
            case 'navigation':
                break;
            default:
                config;
        }
    }
    if (config === false) {
        // `false` and "auto" are equivalent once resolved.
        return 'auto';
    } else {
        return config;
    }
}
async function resolveEnsureStaticConfigImpl(tree) {
    const { mod: layoutOrPageMod, filePath } = await (0, _appdirmodule.getLayoutOrPageModule)(tree);
    const config = getEnsureStaticConfigForModule(layoutOrPageMod);
    const parentResult = {
        config,
        filePath: filePath ?? null
    };
    // Walk the slots if any and validate that they don't have incompatible configs
    // with each other. If compatible, pick the most constrained value from the slots.
    let slotsResult = null;
    let slotResultKey = null;
    const { parallelRoutes } = (0, _parseloadertree.parseLoaderTree)(tree);
    for(const parallelRouteKey in parallelRoutes){
        const parallelRoute = parallelRoutes[parallelRouteKey];
        const childResult = await resolveEnsureStaticConfigImpl(parallelRoute);
        if (!slotsResult) {
            slotsResult = childResult;
            slotResultKey = parallelRouteKey;
        } else {
            // Check if the child is compatible with the current result for the slots.
            switch(compareEnsureStatic(childResult.config, slotsResult.config)){
                case 2:
                    {
                        // 'auto' is compatible with anything, but if the current result is 'auto' and the new one isn't,
                        // we want to use the more specific result.
                        if (slotsResult.config === 'auto' && childResult.config !== 'auto') {
                            slotsResult = childResult;
                            slotResultKey = parallelRouteKey;
                        }
                        break;
                    }
                case 4:
                case 1:
                case 3:
                    {
                        throw new Error(`Parallel slots cannot have incompatible \`ensureStatic\`.` + `\n  ${formatParallelSlot(slotResultKey)}: ` + `\n    ${formatEnsureStaticExport(slotsResult.config)}` + `\n    (from: ${slotsResult.filePath})` + `\n` + `\n  ${formatParallelSlot(parallelRouteKey)}: ` + `\n    ${formatEnsureStaticExport(childResult.config)}` + `\n    (from: ${childResult.filePath})` + `\n` + `\n Possible fixes:` + `\n - Remove one of the \`ensureStatic\` exports` + `\n - Change one of the  \`ensureStatic\` exports to match the other`);
                    }
            }
        }
    }
    // Child segments can override the config from the parent with a more constrained value,
    // but they cannot have a less constrained value.
    if (!slotsResult) {
        return parentResult;
    } else {
        const comparison = compareEnsureStatic(slotsResult.config, parentResult.config);
        switch(comparison){
            case 2:
                {
                    // 'auto' is compatible with anything, but if the parent result is 'auto' and the slots one isn't,
                    // we want to use the more constrained result.
                    if (parentResult.config === 'auto' && slotsResult.config !== 'auto') {
                        return slotsResult;
                    } else {
                        return parentResult;
                    }
                }
            case 3:
                {
                    return slotsResult;
                }
            case 1:
            case 4:
                {
                    throw new Error((comparison === 1 ? `A child segment cannot override a parent segment with a less-constrained \`ensureStatic\`.` : `A child segment cannot override a parent segment with an incompatible \`ensureStatic\`.`) + `\n  Parent has: ` + `\n    ${formatEnsureStaticExport(parentResult.config)}` + `\n    (from: ${parentResult.filePath})` + `\n  Child has: ` + `\n    ${formatEnsureStaticExport(slotsResult.config)}` + `\n    (from: ${slotsResult.filePath})` + `\n` + `\n Possible fixes:` + `\n - Remove one of the \`ensureStatic\` exports` + `\n - Change one of the  \`ensureStatic\` exports to match the other`);
                }
        }
    }
}
function formatParallelSlot(slot) {
    return slot === 'children' ? slot : `@${slot}`;
}
function formatEnsureStaticExport(config) {
    return `export const ensureStatic = ${JSON.stringify(config)}`;
}
var Comparison = /*#__PURE__*/ function(Comparison) {
    Comparison[Comparison["LessConstrained"] = 1] = "LessConstrained";
    Comparison[Comparison["Compatible"] = 2] = "Compatible";
    Comparison[Comparison["MoreConstrained"] = 3] = "MoreConstrained";
    Comparison[Comparison["Incompatible"] = 4] = "Incompatible";
    return Comparison;
}(Comparison || {});
const ENSURE_STATIC_ORDER = [
    'shell',
    'prefetch',
    'navigation'
];
function compareEnsureStatic(left, right) {
    // 'auto' is compatible with everything.
    if (left === 'auto' || right === 'auto') {
        return 2;
    }
    // `false` is compatible with false.
    if (left === false && right === false) {
        return 2;
    }
    // If only one of the values is `false` (we know it's not both), it's incompatible.
    if (left === false || right === false) {
        return 4;
    }
    const leftSort = ENSURE_STATIC_ORDER.indexOf(left);
    const rightSort = ENSURE_STATIC_ORDER.indexOf(right);
    return leftSort < rightSort ? 1 : leftSort === rightSort ? 2 : 3;
}
function getEnsureStaticConfigForModule(mod) {
    return (mod ? mod.ensureStatic : undefined) ?? 'auto';
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/app-render/staged-rendering.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    RENDER_STAGE_ADVANCE_ORDER: null,
    RenderStage: null,
    StagedRenderingController: null,
    SyncIOMode: null,
    getNextStage: null,
    isAdvanceableRenderStage: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    RENDER_STAGE_ADVANCE_ORDER: function() {
        return RENDER_STAGE_ADVANCE_ORDER;
    },
    RenderStage: function() {
        return RenderStage;
    },
    StagedRenderingController: function() {
        return StagedRenderingController;
    },
    SyncIOMode: function() {
        return SyncIOMode;
    },
    getNextStage: function() {
        return getNextStage;
    },
    isAdvanceableRenderStage: function() {
        return isAdvanceableRenderStage;
    }
});
const _invarianterror = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/invariant-error.js [app-ssr] (ecmascript)");
const _promisewithresolvers = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/promise-with-resolvers.js [app-ssr] (ecmascript)");
var RenderStage = /*#__PURE__*/ function(RenderStage) {
    RenderStage[RenderStage["Before"] = 1] = "Before";
    //
    RenderStage[RenderStage["ShellStatic"] = 10] = "ShellStatic";
    /** Discrimination-only stage: `prefetch()` in validation renders (static) */ RenderStage[RenderStage["PrefetchStatic_prefetchApi"] = 11] = "PrefetchStatic_prefetchApi";
    RenderStage[RenderStage["PrefetchStatic"] = 12] = "PrefetchStatic";
    RenderStage[RenderStage["NavigationStatic"] = 13] = "NavigationStatic";
    RenderStage[RenderStage["Static"] = 14] = "Static";
    //
    RenderStage[RenderStage["ShellRuntime"] = 20] = "ShellRuntime";
    /** Discrimination-only stage: `prefetch()` in validation renders (runtime) */ RenderStage[RenderStage["PrefetchRuntime_prefetchApi"] = 21] = "PrefetchRuntime_prefetchApi";
    RenderStage[RenderStage["PrefetchRuntime"] = 22] = "PrefetchRuntime";
    RenderStage[RenderStage["NavigationRuntime"] = 23] = "NavigationRuntime";
    //
    RenderStage[RenderStage["Dynamic"] = 30] = "Dynamic";
    RenderStage[RenderStage["Abandoned"] = 40] = "Abandoned";
    return RenderStage;
}({});
const RENDER_STAGE_ADVANCE_ORDER = [
    10,
    11,
    12,
    13,
    14,
    20,
    21,
    22,
    23,
    30
];
function getNextStage(stage) {
    return RENDER_STAGE_ADVANCE_ORDER[RENDER_STAGE_ADVANCE_ORDER.indexOf(stage) + 1];
}
function isAdvanceableRenderStage(stage) {
    return 1 < stage && stage <= 30;
}
var SyncIOMode = /*#__PURE__*/ function(SyncIOMode) {
    /** Sync IO does not error in any stage. */ SyncIOMode[SyncIOMode["Untracked"] = 1] = "Untracked";
    /** Before `partialPrefetching`: Sync IO errors in static stages, and is allowed otherwise. */ SyncIOMode[SyncIOMode["AllowedInRuntimeOrDynamic"] = 2] = "AllowedInRuntimeOrDynamic";
    /** After `partialPrefetching`: Sync IO errors in all stages other than dynamic. */ SyncIOMode[SyncIOMode["AllowedInDynamic"] = 3] = "AllowedInDynamic";
    return SyncIOMode;
}({});
class StagedRenderingController {
    constructor({ abortSignal, abandonController, syncIO, finalStage }){
        this.currentStage = 1;
        this.syncInterruptReason = null;
        this.triggers = createAdvanceableStageTriggers();
        this.abortSignal = abortSignal;
        this.abandonController = abandonController;
        this.syncIOMode = syncIO;
        this.finalStage = finalStage;
        if (abortSignal) {
            abortSignal.addEventListener('abort', ()=>{
                // Reject all stage promises that haven't already been resolved.
                // `cancelStageTrigger` is a noop if the trigger already resolved.
                const { reason } = abortSignal;
                for (const trigger of Object.values(this.triggers)){
                    cancelStageTrigger(trigger, reason);
                }
            }, {
                once: true
            });
        }
        if (abandonController) {
            abandonController.signal.addEventListener('abort', ()=>{
                this.abandonRender();
            }, {
                once: true
            });
        }
    }
    /**
   * Schedules a callback that will execute synchronously when the controller is advanced
   * to `stage` or past it, before any promises for that stage are resolved.
   * If the controller is already past `stage`, the callback is executed immediately.
   * */ onStage(stage, callback) {
        addSyncTriggerListener(this.triggers[stage], callback);
    }
    shouldTrackSyncInterrupt() {
        const { syncIOMode, currentStage } = this;
        switch(syncIOMode){
            case 1:
                {
                    return false;
                }
            case 2:
                {
                    // Legacy: track Sync IO only in static stages.
                    // Do not track it before the render, or in runtime/dynamic stages.
                    return currentStage > 1 && currentStage <= 14;
                }
            case 3:
                {
                    // Track sync IO in all cacheable stages.
                    // This means all stages except:
                    // - before the render
                    // - in the dynamic stage
                    return currentStage > 1 && currentStage < 30;
                }
        }
    }
    /** Note: only call this if `shouldTrackSyncInterrupt()` returned true */ syncInterruptCurrentStageWithReason(reason) {
        const { currentStage } = this;
        if (currentStage === 1 || currentStage === 30 || currentStage === 40) {
            // Not interruptible. Defensive noop.
            return;
        }
        // If Sync IO occurs during an abandonable render, we trigger the abandon.
        // The abandon listener will call abandonRender which advances through
        // stages to let caches fill before marking as Abandoned.
        if (this.abandonController) {
            this.abandonController.abort();
            return;
        }
        if (this.abortSignal) {
            // If this is an abortable render, we capture the interruption reason and stop advancing.
            // We don't release any more promises.
            // The caller is expected to abort the signal.
            this.syncInterruptReason = reason;
            this.currentStage = 40;
            return;
        }
        // If we're in a non-abandonable & non-abortable render,
        // we need to advance to the Dynamic stage and capture the interruption reason.
        // (in dev, this will be the restarted render)
        this.syncInterruptReason = reason;
        this.advanceStage(30);
    }
    getSyncInterruptReason() {
        return this.syncInterruptReason;
    }
    getStageEndTime(stage) {
        return this.triggers[getNextStage(stage)].triggeredAt ?? Infinity;
    }
    abandonRender() {
        // In staged rendering, only the initial render is abandonable.
        // We can abandon the initial render if
        //   1. We notice a cache miss, and need to wait for caches to fill
        //   2. A sync IO error occurs, and the render should be interrupted
        //      (this might be a lazy intitialization of a module,
        //       so we still want to restart in this case and see if it still occurs)
        // In either case, we'll be doing another render after this one,
        // so we only want to unblock the next stage, not Dynamic, because
        // unblocking the dynamic stage would likely lead to wasted (uncached) IO.
        const { currentStage } = this;
        if (currentStage === 1) {
            throw new _invarianterror.InvariantError("A render that hasn't started yet cannot be abandoned");
        }
        if (currentStage === 30 || currentStage === 40) {
            // We shouldn't ever trigger an abandon in these. Defensive noop.
            return;
        }
        // Resolve all stages after the current one, up to runtime (excluding dynamic)
        const nextStageIx = RENDER_STAGE_ADVANCE_ORDER.indexOf(currentStage) + 1;
        const dynamicStageIx = RENDER_STAGE_ADVANCE_ORDER.indexOf(30);
        for(let i = nextStageIx; i < dynamicStageIx; i++){
            this.resolveStage(RENDER_STAGE_ADVANCE_ORDER[i]);
        }
        this.currentStage = 40;
    }
    advanceStage(targetStage) {
        if (this.finalStage !== null && targetStage > this.finalStage) {
            throw new _invarianterror.InvariantError(`Attempted to advance to stage ${RenderStage[targetStage]} but the render is limited to ${RenderStage[this.finalStage]}`);
        }
        const { currentStage } = this;
        if (currentStage === 30 || currentStage === 40) {
            // Terminal stages, nowhere left to advance.
            return;
        }
        // If we're already at the target stage or beyond, do nothing.
        if (targetStage <= currentStage) {
            return;
        }
        this.currentStage = targetStage;
        // Resolve all stages between the current stage and the target.
        const nextStageIx = currentStage === 1 ? 0 : RENDER_STAGE_ADVANCE_ORDER.indexOf(currentStage) + 1;
        const targetStageIx = RENDER_STAGE_ADVANCE_ORDER.indexOf(targetStage);
        for(let i = nextStageIx; i <= targetStageIx; i++){
            this.resolveStage(RENDER_STAGE_ADVANCE_ORDER[i]);
        }
    }
    resolveStage(stage) {
        fireStageTrigger(this.triggers[stage]);
    }
    getStagePromise(stage) {
        return this.triggers[stage].promise;
    }
    waitForStage(stage) {
        return this.getStagePromise(stage);
    }
    delayUntilStage(stage, displayName, resolvedValue) {
        const stagePromise = this.getStagePromise(stage);
        const promise = ("TURBOPACK compile-time truthy", 1) ? makeDevtoolsIOPromiseFromIOTrigger(stagePromise, displayName, resolvedValue) : "TURBOPACK unreachable";
        // Analogously to `makeDynamicHangingPromise`, we might reject this promise if the signal is invoked.
        // (e.g. in the case where we don't want want the render to proceed to the dynamic stage and abort it).
        // We shouldn't consider this an unhandled rejection, so we attach a noop catch handler here to suppress this warning.
        if (this.abortSignal) {
            promise.catch(ignoreReject);
        }
        return promise;
    }
}
function createAdvanceableStageTriggers() {
    const triggers = {};
    for (const stage of RENDER_STAGE_ADVANCE_ORDER){
        triggers[stage] = createStageTrigger();
    }
    return triggers;
}
function ignoreReject() {}
// TODO(restart-on-cache-miss): the layering of `delayUntilStage`,
// `makeDevtoolsIOPromiseFromIOTrigger` and and `makeDevtoolsIOAwarePromise`
// is confusing, we should clean it up.
function makeDevtoolsIOPromiseFromIOTrigger(ioTrigger, displayName, resolvedValue) {
    // If we create a `new Promise` and give it a displayName
    // (with no userspace code above us in the stack)
    // React Devtools will use it as the IO cause when determining "suspended by".
    // In particular, it should shadow any inner IO that resolved/rejected the promise
    // (in case of staged rendering, this will be the `setTimeout` that triggers the relevant stage)
    const promise = new Promise((resolve, reject)=>{
        ioTrigger.then(resolve.bind(null, resolvedValue), reject);
    });
    if (displayName !== undefined) {
        // @ts-expect-error
        promise.displayName = displayName;
    }
    return promise;
}
function addSyncTriggerListener(trigger, listener) {
    if (trigger.state === 'pending') {
        trigger._listeners.push(listener);
    } else {
        listener();
    }
}
function createStageTrigger() {
    const { promise, resolve, reject } = (0, _promisewithresolvers.createPromiseWithResolvers)();
    return {
        state: 'pending',
        triggeredAt: null,
        promise,
        _listeners: [],
        _resolvePromise: resolve,
        _rejectPromise: reject
    };
}
function fireStageTrigger(trigger) {
    if (trigger.state !== 'pending') {
        return;
    }
    trigger.state = 'triggered';
    trigger.triggeredAt = performance.now() + performance.timeOrigin;
    try {
        const { _listeners: listeners } = trigger;
        for(let i = 0; i < listeners.length; i++){
            listeners[i]();
        }
        listeners.length = 0;
    } finally{
        trigger._resolvePromise();
    }
}
function cancelStageTrigger(trigger, reason) {
    if (trigger.state !== 'pending') {
        return;
    }
    trigger.state = 'cancelled';
    // we didn't trigger, so don't save `triggeredAt`.
    // We're not gonna fire the listeners, we may as well free them.
    trigger._listeners.length = 0;
    // Suppress unhandled rejection warnings for promises that no one is awaiting.
    trigger.promise.catch(ignoreReject);
    trigger._rejectPromise(reason);
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/dynamic-rendering-utils.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    ClientHookDynamicError: null,
    RENDER_STAGES_BY_DATA_KIND: null,
    applyOwnerStack: null,
    createPrerenderDataTracking: null,
    finishPrerenderDataTracking: null,
    isClientHookDynamicError: null,
    isHangingPromiseRejectionError: null,
    makeClientHookHangingPromise: null,
    makeDevtoolsIOAwarePromise: null,
    makeDynamicHangingPromise: null,
    makeFallbackParamsHangingPromise: null,
    makePrefetchHangingPromise: null,
    makePromiseFromTrigger: null,
    makeSessionDataHangingPromise: null,
    makeURLDataHangingPromise: null,
    makeUnknownRuntimeDataHangingPromise: null,
    makeUntrackedHangingPromise: null,
    trackFallbackParamsAccessed: null,
    trackIncompatibleShellContent: null,
    trackPromiseUsed: null,
    trackURLDataAccessed: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    ClientHookDynamicError: function() {
        return ClientHookDynamicError;
    },
    RENDER_STAGES_BY_DATA_KIND: function() {
        return RENDER_STAGES_BY_DATA_KIND;
    },
    applyOwnerStack: function() {
        return applyOwnerStack;
    },
    createPrerenderDataTracking: function() {
        return createPrerenderDataTracking;
    },
    finishPrerenderDataTracking: function() {
        return finishPrerenderDataTracking;
    },
    isClientHookDynamicError: function() {
        return isClientHookDynamicError;
    },
    isHangingPromiseRejectionError: function() {
        return isHangingPromiseRejectionError;
    },
    makeClientHookHangingPromise: function() {
        return makeClientHookHangingPromise;
    },
    makeDevtoolsIOAwarePromise: function() {
        return makeDevtoolsIOAwarePromise;
    },
    makeDynamicHangingPromise: function() {
        return makeDynamicHangingPromise;
    },
    makeFallbackParamsHangingPromise: function() {
        return makeFallbackParamsHangingPromise;
    },
    makePrefetchHangingPromise: function() {
        return makePrefetchHangingPromise;
    },
    makePromiseFromTrigger: function() {
        return makePromiseFromTrigger;
    },
    makeSessionDataHangingPromise: function() {
        return makeSessionDataHangingPromise;
    },
    makeURLDataHangingPromise: function() {
        return makeURLDataHangingPromise;
    },
    makeUnknownRuntimeDataHangingPromise: function() {
        return makeUnknownRuntimeDataHangingPromise;
    },
    makeUntrackedHangingPromise: function() {
        return makeUntrackedHangingPromise;
    },
    trackFallbackParamsAccessed: function() {
        return trackFallbackParamsAccessed;
    },
    trackIncompatibleShellContent: function() {
        return trackIncompatibleShellContent;
    },
    trackPromiseUsed: function() {
        return trackPromiseUsed;
    },
    trackURLDataAccessed: function() {
        return trackURLDataAccessed;
    }
});
const _invarianterror = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/invariant-error.js [app-ssr] (ecmascript)");
const _promisewithresolvers = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/promise-with-resolvers.js [app-ssr] (ecmascript)");
const _ensurestatic = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/app-render/segment-config/ensure-static.js [app-ssr] (ecmascript)");
const _stagedrendering = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/app-render/staged-rendering.js [app-ssr] (ecmascript)");
const _workasyncstorageexternal = __turbopack_context__.r("[externals]/next/dist/server/app-render/work-async-storage.external.js [external] (next/dist/server/app-render/work-async-storage.external.js, cjs)");
const _workunitasyncstorageexternal = __turbopack_context__.r("[externals]/next/dist/server/app-render/work-unit-async-storage.external.js [external] (next/dist/server/app-render/work-unit-async-storage.external.js, cjs)");
const _runtimereactsexternal = __turbopack_context__.r("[externals]/next/dist/server/runtime-reacts.external.js [external] (next/dist/server/runtime-reacts.external.js, cjs)");
function isHangingPromiseRejectionError(err) {
    if (typeof err !== 'object' || err === null || !('digest' in err)) {
        return false;
    }
    return err.digest === HANGING_PROMISE_REJECTION;
}
const HANGING_PROMISE_REJECTION = 'HANGING_PROMISE_REJECTION';
class HangingPromiseRejectionError extends Error {
    constructor(route, expression){
        super(`During prerendering, ${expression} rejects when the prerender is complete. Typically these errors are handled by React but if you move ${expression} to a different context by using \`setTimeout\`, \`after\`, or similar functions you may observe this error and you should handle it in that context. This occurred at route "${route}".`), this.route = route, this.expression = expression, this.digest = HANGING_PROMISE_REJECTION;
    }
}
const CLIENT_HOOK_DYNAMIC = 'CLIENT_HOOK_DYNAMIC';
class ClientHookDynamicError extends Error {
    constructor(route, expression){
        super(`Route "${route}": Next.js encountered URL data \`${expression}\` in a Client Component outside of \`<Suspense>\`.\n\n` + `This blocks prerendering because the value is only available at runtime.\n\n` + `Ways to fix this:\n` + `  - [stream] Wrap the component in \`<Suspense fallback={...}>\` so the hook value streams in after prerendering\n` + `  - [block] Set \`export const instant = false\` to allow a blocking route\n\n` + `Learn more: https://nextjs.org/docs/messages/blocking-prerender-client-hook`), this.digest = CLIENT_HOOK_DYNAMIC;
    }
}
function isClientHookDynamicError(err) {
    if (typeof err !== 'object' || err === null || !('digest' in err)) {
        return false;
    }
    return err.digest === CLIENT_HOOK_DYNAMIC;
}
const abortListenersBySignal = new WeakMap();
function makeDynamicHangingPromise(signal, route, expression) {
    return makeHangingPromiseWithError(signal, new HangingPromiseRejectionError(route, expression));
}
function makeUntrackedHangingPromise(signal, route, expression) {
    return makeHangingPromiseWithError(signal, new HangingPromiseRejectionError(route, expression));
}
function makeSessionDataHangingPromise(signal, route, expression, workUnitStore) {
    const promise = makeHangingPromiseWithError(signal, new HangingPromiseRejectionError(route, expression));
    return trackPromiseUsed(promise, trackSessionDataAccessed.bind(null, workUnitStore, expression));
}
function makeURLDataHangingPromise(signal, route, expression, workUnitStore) {
    const promise = makeHangingPromiseWithError(signal, new HangingPromiseRejectionError(route, expression));
    if (workUnitStore === null) {
        return promise;
    }
    return trackPromiseUsed(promise, trackURLDataAccessed.bind(null, workUnitStore, expression));
}
function makeUnknownRuntimeDataHangingPromise(signal, route, expression, workUnitStore) {
    // We don't know if this is session or URL data, i.e. if it should affect the shell
    // or only the prefetch. Track it conservatively as affecting both.
    return makeSessionDataHangingPromise(signal, route, expression, workUnitStore);
}
function makePrefetchHangingPromise(signal, route, expression) {
    return makeUntrackedHangingPromise(signal, route, expression);
}
function makeFallbackParamsHangingPromise(signal, route, expression, workUnitStore) {
    const promise = makeHangingPromiseWithError(signal, new HangingPromiseRejectionError(route, expression));
    if (workUnitStore === null) {
        return promise;
    }
    return trackPromiseUsed(promise, trackFallbackParamsAccessed.bind(null, workUnitStore, expression));
}
function createPrerenderDataTracking() {
    return {
        runtimeDataAccessed: (0, _promisewithresolvers.createPromiseWithResolvers)(),
        shouldAttemptStaticShell: true,
        shouldAttemptStaticPrefetch: true
    };
}
function finishPrerenderDataTracking(prerenderDataTracking) {
    // If a runtime data access already resolved this promise, this is a no-op.
    prerenderDataTracking.runtimeDataAccessed.resolve(false);
}
/**
 * Records on a static prerender store that the render accessed a data source
 * which would have resolved in a runtime shell (or runtime prefetch).
 * No-op for all other store types.
 *
 * Prefer `makeRuntimeHangingPromise`. Use this function only when implementing
 * similar tracking and that one is not enough.
 */ function trackSessionDataAccessed(workUnitStore, expression) {
    trackRuntimeDataAccessed(workUnitStore, 1, expression);
}
function trackURLDataAccessed(workUnitStore, expression) {
    trackRuntimeDataAccessed(workUnitStore, 2, expression);
}
function trackFallbackParamsAccessed(workUnitStore, expression) {
    trackRuntimeDataAccessed(workUnitStore, 3, expression);
}
function trackRuntimeDataAccessed(workUnitStore, dataKind, expression) {
    switch(workUnitStore.type){
        case 'prerender':
            {
                const { prerenderDataTracking, stagedRendering } = workUnitStore;
                if (!prerenderDataTracking || !stagedRendering) {
                    return;
                }
                const { currentStage } = stagedRendering;
                if (currentStage === _stagedrendering.RenderStage.Before) {
                    console.error(new _invarianterror.InvariantError('Unexpected trackRuntimeDataAccessed in the Before stage.'));
                    return;
                }
                if (currentStage >= _stagedrendering.RenderStage.NavigationStatic) {
                    // Ignore any accesses that happen after `navigation()` resolves.
                    // The purpose of this tracking is to judge whether a runtime prefetch
                    // would give us a more complete result than a static one.
                    // But `navigation()` wouldn't have resolved in a runtime prefetch,
                    // so e.g. `await navigation(); await cookies()` wouldn't have more content
                    // in those, and we shouldn't count it.
                    return;
                }
                const ensureStaticLevel = workUnitStore.ensureStaticLevel ?? _ensurestatic.EnsureStaticLevel.None;
                // NOTE: In general, we keep hints in sync with `needsRuntimeRequest`, but they
                // don't have to always match. The client re-uses hints for the entire route,
                // while `needsRuntimeRequest` can vary across individual prerendered param values
                // (e.g. if cookies are accessed depending on a param value).
                // Hints can also become outdated if a route only starts using runtime data
                // after a revalidation, so we have to expect this and be resilient to it.
                // Also see the upgradeable fallback params case below, which deliberately
                // puts them out of sync.
                switch(dataKind){
                    case 1:
                        {
                            // Potentially deopt both the shell and the prefetch,
                            // because if the shell accessed runtime data, so does the prefetch.
                            // However, if we're already past the shell stage, the shell is not affected.
                            // (which makes e.g. `await prefetch(); await cookies()` only affect the prefetch)
                            let firstAffectedStage = null;
                            if (currentStage <= _stagedrendering.RenderStage.ShellStatic && // Only track if we're not forcing the shell to be static.
                            ensureStaticLevel < _ensurestatic.EnsureStaticLevel.Shell) {
                                prerenderDataTracking.shouldAttemptStaticShell = false;
                                firstAffectedStage ??= _stagedrendering.RenderStage.ShellStatic;
                                logRuntimeDeopt == null ? void 0 : logRuntimeDeopt(expression, 'shell');
                            }
                            if (currentStage <= _stagedrendering.RenderStage.PrefetchStatic && // Only track if we're not forcing the prefetch to be static.
                            ensureStaticLevel < _ensurestatic.EnsureStaticLevel.Prefetch) {
                                prerenderDataTracking.shouldAttemptStaticPrefetch = false;
                                // NOTE: if the shell is affected, don't override it.
                                firstAffectedStage ??= _stagedrendering.RenderStage.PrefetchStatic;
                                logRuntimeDeopt == null ? void 0 : logRuntimeDeopt(expression, 'prefetch');
                            }
                            if (firstAffectedStage !== null) {
                                markRuntimeDataAccessWhenStageReached(prerenderDataTracking, stagedRendering, firstAffectedStage);
                            }
                            break;
                        }
                    case 3:
                        {
                            if (workUnitStore.isFallbackUpgradeable) {
                                // An fallback-param access is transient when the route is
                                // fallback-upgradeable (i.e. ISR later produces the concrete prerender a
                                // static prefetch would hit) so it does not indicate the need for a runtime
                                // request and thus does not affect the static hints.
                                //
                                // If runtime prefetches are not disallowed by `ensureStatic`, then we still
                                // set `runtimeDataAccessed` (while keeping the hints static). This means that
                                // if the concrete prerender isn't ready yet and we served the fallback, then
                                // the client knows it can use a *runtime* prefetch for speculative links --
                                // a runtime prefetch can provide the same content (or more) as the concrete
                                // prerender would.
                                if (ensureStaticLevel < _ensurestatic.EnsureStaticLevel.Prefetch) {
                                    markRuntimeDataAccessWhenStageReached(prerenderDataTracking, stagedRendering, _stagedrendering.RenderStage.PrefetchStatic);
                                    logRuntimeUpgradeableFallback == null ? void 0 : logRuntimeUpgradeableFallback();
                                }
                                break;
                            }
                        // not an upgradeable fallback param access, so we treat it as URL data.
                        // intentional fallthrough
                        }
                    case 2:
                        {
                            // Only deopt the prefetch, not the shell, which cannot access URL data anyway.
                            if (currentStage <= _stagedrendering.RenderStage.PrefetchStatic && ensureStaticLevel < _ensurestatic.EnsureStaticLevel.Prefetch) {
                                prerenderDataTracking.shouldAttemptStaticPrefetch = false;
                                logRuntimeDeopt == null ? void 0 : logRuntimeDeopt(expression, 'prefetch');
                                markRuntimeDataAccessWhenStageReached(prerenderDataTracking, stagedRendering, _stagedrendering.RenderStage.PrefetchStatic);
                            }
                            break;
                        }
                }
                break;
            }
        case 'prerender-client':
        case 'prerender-legacy':
        case 'prerender-runtime':
        case 'validation-client':
        case 'request':
        case 'cache':
        case 'private-cache':
        case 'unstable-cache':
        case 'build-time-generator':
            break;
        default:
            workUnitStore;
    }
}
/**
 * Tracks a runtime data access on the `runtimeDataAccessed` promise,
 * but with a delay until `targetStage`.
 *
 * When we encounter a URL data access like `await params`, we need to mark the
 * *prefetch* as needing runtime data, but the *shell* should remain unaffected
 * (because it cannot access params anyway).
 *
 * However, the shell and the prefetch share one `runtimeDataAccessed` promise,
 * and it needs to be accurately rewindable by the client
 * In other words, we need to make sure that it reads as `false` when rewound
 * to a shell, but as `true` in the final response (the prefetch).
 *
 * This means that if the `await params` is encountered during the shell stage, we
 * cannot resolve `runtimeDataAccessed` immediately.
 * Instead, we delay the resolution until the PrefetchStatic stage, so the promise
 * will remain unresolved when rewound to the shell stage (which reads as `false`).
 */ function markRuntimeDataAccessWhenStageReached(prerenderDataTracking, stageController, targetStage) {
    const { runtimeDataAccessed } = prerenderDataTracking;
    // NOTE: If we're already in or past the target stage, we can avoid allocating a closure,
    // because `onStage` would've executed the callback immediately anyway.
    if (stageController.currentStage >= targetStage) {
        runtimeDataAccessed.resolve(true);
    } else {
        stageController.onStage(targetStage, runtimeDataAccessed.resolve.bind(null, true));
    }
}
const logRuntimeDeopt = process.env.NEXT_PRIVATE_DEBUG_RUNTIME_DATA ? (expression, kind)=>{
    const { route } = _workasyncstorageexternal.workAsyncStorage.getStore();
    console.log(`Route '${route}': deopting to a runtime ${kind} because it used ${expression}`);
} : undefined;
const logRuntimeUpgradeableFallback = process.env.NEXT_PRIVATE_DEBUG_RUNTIME_DATA ? ()=>{
    const { route } = _workasyncstorageexternal.workAsyncStorage.getStore();
    console.log(`Route '${route}': marking upgradeable fallback as runtime prefetchable`);
} : undefined;
function trackIncompatibleShellContent(workUnitStore, reason) {
    const { stagedRendering } = workUnitStore;
    if (!stagedRendering) {
        return;
    }
    // TODO(app-shells): optimize this to only consider stages that are relevant for validation.
    // We should only track incompatible content when it can affect them.
    // For now, we simply exclude everything that happens in the dynamic stage.
    // (Note that we also need to account for cache misses that move things to a
    // different stage -- those should also preemptively set `hasIncompatibleShellContent`
    // because there's a chance that a render with warm caches would set it)
    const { currentStage } = stagedRendering;
    if (currentStage === _stagedrendering.RenderStage.Dynamic || currentStage === _stagedrendering.RenderStage.Abandoned) {
        return;
    }
    if (process.env.NEXT_PRIVATE_DEBUG_VALIDATION) {
        const workStore = _workasyncstorageexternal.workAsyncStorage.getStore();
        console.log(`Route ${workStore.route}: Incompatible shell content: ${reason}`);
    }
    workUnitStore.hasIncompatibleShellContent = true;
}
function makeClientHookHangingPromise(signal, error) {
    return makeHangingPromiseWithError(signal, error);
}
function makeHangingPromiseWithError(signal, error) {
    if (signal.aborted) {
        return Promise.reject(error);
    } else {
        const hangingPromise = new Promise((_, reject)=>{
            const boundRejection = reject.bind(null, error);
            let currentListeners = abortListenersBySignal.get(signal);
            if (currentListeners) {
                currentListeners.push(boundRejection);
            } else {
                const listeners = [
                    boundRejection
                ];
                abortListenersBySignal.set(signal, listeners);
                signal.addEventListener('abort', ()=>{
                    for(let i = 0; i < listeners.length; i++){
                        listeners[i]();
                    }
                }, {
                    once: true
                });
            }
        });
        // We are fine if no one actually awaits this promise. We shouldn't consider this an unhandled rejection so
        // we attach a noop catch handler here to suppress this warning. If you actually await somewhere or construct
        // your own promise out of it you'll need to ensure you handle the error when it rejects.
        hangingPromise.catch(ignoreReject);
        return hangingPromise;
    }
}
function ignoreReject() {}
function makePromiseFromTrigger(trigger, value) {
    const promise = trigger.then(()=>value);
    promise.catch(ignoreReject);
    return promise;
}
function makeDevtoolsIOAwarePromise(underlying, requestStore, stage) {
    if (requestStore.stagedRendering) {
        // We resolve each stage in a timeout, so React DevTools will pick this up as IO.
        return requestStore.stagedRendering.delayUntilStage(stage, undefined, underlying);
    }
    // in React DevTools if we resolve in a setTimeout we will observe
    // the promise resolution as something that can suspend a boundary or root.
    return new Promise((resolve)=>{
        // Must use setTimeout to be considered IO React DevTools. setImmediate will not work.
        setTimeout(()=>{
            resolve(underlying);
        }, 0);
    });
}
function trackPromiseUsed(promise, onUse) {
    // We can instrument `.then()/.catch()/.finally()` in one go by using a Promise subclass
    // that implements a custom `.then()`, because `catch` and `finally` delegate to it.
    //
    // Alternative implementation ideas that were tried and rejected:
    //
    // 1. Patching the methods directly via `promise.then = (..args) => { ... }`:
    //   doesn't work, because Node does not call the monkeypatched methods for native `await`:
    //   > Native Promise [...]: The promise is directly used and awaited natively, without calling `then()`.
    //   > https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await#description
    //
    // 2. Wrapping in a proxy that returns a custom `then/catch/finally`:
    //   breaks async stacks in React's IO tracking (stack becomes `Promise.then`)
    return TrackedPromise.from(promise, onUse);
}
class TrackedPromise extends Promise {
    #onUse;
    // We don't need derived promises to also be a TrackedPromise.
    // We only care about the first level of `.then()`.
    static get [Symbol.species]() {
        return Promise;
    }
    static from(promise, onUse) {
        // Whenever the promise we're tracking resolves/rejects, we should follow.
        const tracked = new TrackedPromise(promise.then.bind(promise));
        tracked.#onUse = onUse;
        // Hanging promises catch rejections when created. Tracked promises are generally derived
        // from promises that may hang & reject, so we need to do the same.
        // However, we have to bypass the tracking we do in `TrackedPromise.then`.
        // (we're using `then` directly, because `catch` ends up delegating `TrackedPromise.then`)
        Promise.prototype.then.call(tracked, undefined, ignoreReject);
        return tracked;
    }
    then(onFulfilled, onRejected) {
        const onUse = this.#onUse;
        if (onUse) {
            try {
                onUse();
            } catch (err) {
                // We don't want to break the method even if our tracking errored.
                console.error(err);
            }
        }
        return Promise.prototype.then.call(this, onFulfilled, onRejected);
    }
    constructor(...args){
        super(...args), this.#onUse = null;
    }
}
const RENDER_STAGES_BY_DATA_KIND = {
    sessionData: _stagedrendering.RenderStage.ShellRuntime,
    /**
   * Statically-prerenderable URL data, like static `params`.
   * It may need to be pushed to a runtime stage in a runtime prerender,
   * but it's semantically distinct from `runtimeUrlData` like `searchParams`,
   * which is always excluded from static prerenders.
   * */ staticUrlData: {
        /**
     * From that app's point of view, `prefetch()` is semantically the same as
     * `staticUrlData`, because it does not resolve in a shell but resolves in
     * a prefetch (even a static one).
     * We handle it separately to provide a specialized error in validation renders.
     */ prefetchApi: {
            static: _stagedrendering.RenderStage.PrefetchStatic_prefetchApi,
            runtime: _stagedrendering.RenderStage.PrefetchRuntime_prefetchApi
        },
        static: _stagedrendering.RenderStage.PrefetchStatic,
        runtime: _stagedrendering.RenderStage.PrefetchRuntime
    },
    /**
   * URL data that is never statically-prerenderable, like static `searchParams`.
   * */ runtimeUrlData: _stagedrendering.RenderStage.PrefetchRuntime
};
function applyOwnerStack(error) {
    if ("TURBOPACK compile-time truthy", 1) {
        var _getClientReact_captureOwnerStack, _getClientReact, _getServerReact_captureOwnerStack, _getServerReact;
        let ownerStack;
        const workUnitStore = _workunitasyncstorageexternal.workUnitAsyncStorage.getStore();
        // captureOwnerStack() returns the owner stack for the current React
        // rendering context. Inside a cache scope this only includes the inner
        // component tree. The outer owner stack (captured before entering the
        // cache boundary in use-cache-wrapper.ts) is stored on the cache store.
        // We concatenate both to get the full component tree.
        const innerOwnerStack = ((_getClientReact = (0, _runtimereactsexternal.getClientReact)()) == null ? void 0 : (_getClientReact_captureOwnerStack = _getClientReact.captureOwnerStack) == null ? void 0 : _getClientReact_captureOwnerStack.call(_getClientReact)) ?? ((_getServerReact = (0, _runtimereactsexternal.getServerReact)()) == null ? void 0 : (_getServerReact_captureOwnerStack = _getServerReact.captureOwnerStack) == null ? void 0 : _getServerReact_captureOwnerStack.call(_getServerReact));
        switch(workUnitStore == null ? void 0 : workUnitStore.type){
            case 'cache':
            case 'private-cache':
                ownerStack = (innerOwnerStack || '') + (workUnitStore.outerOwnerStack || '') || undefined;
                break;
            case 'unstable-cache':
            case 'request':
            case 'prerender':
            case 'prerender-legacy':
            case 'prerender-runtime':
            case 'prerender-client':
            case 'validation-client':
            case 'build-time-generator':
            case undefined:
                ownerStack = innerOwnerStack;
                break;
            default:
                workUnitStore;
        }
        if (ownerStack) {
            let stack = ownerStack;
            if (error.stack) {
                const frames = [];
                for (const frame of error.stack.split('\n').slice(1)){
                    if (frame.includes('react_stack_bottom_frame')) {
                        break;
                    }
                    frames.push(frame);
                }
                stack = '\n' + frames.join('\n') + stack;
            }
            error.stack = error.name + ': ' + error.message + stack;
        }
    }
    return error;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/lib/app-dir-module.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    getComponentTypeModule: null,
    getLayoutOrPageModule: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    getComponentTypeModule: function() {
        return getComponentTypeModule;
    },
    getLayoutOrPageModule: function() {
        return getLayoutOrPageModule;
    }
});
const _segment = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/segment.js [app-ssr] (ecmascript)");
async function getLayoutOrPageModule(loaderTree) {
    const { layout, page, defaultPage } = loaderTree[2];
    const isLayout = typeof layout !== 'undefined';
    const isPage = typeof page !== 'undefined';
    const isDefaultPage = typeof defaultPage !== 'undefined' && loaderTree[0] === _segment.DEFAULT_SEGMENT_KEY;
    let mod = undefined;
    let modType = undefined;
    let filePath = undefined;
    if (isLayout) {
        mod = await layout[0]();
        modType = 'layout';
        filePath = layout[1];
    } else if (isPage) {
        mod = await page[0]();
        modType = 'page';
        filePath = page[1];
    } else if (isDefaultPage) {
        mod = await defaultPage[0]();
        modType = 'page';
        filePath = defaultPage[1];
    }
    return {
        mod,
        modType,
        filePath
    };
}
async function getComponentTypeModule(loaderTree, moduleType) {
    const { [moduleType]: module1 } = loaderTree[2];
    if (typeof module1 !== 'undefined') {
        return await module1[0]();
    }
    return undefined;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
;
else {
    if ("TURBOPACK compile-time falsy", 0) //TURBOPACK unreachable
    ;
    else {
        if ("TURBOPACK compile-time truthy", 1) {
            if ("TURBOPACK compile-time truthy", 1) {
                module.exports = __turbopack_context__.r("[externals]/next/dist/compiled/next-server/app-page-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/app-page-turbo.runtime.dev.js, cjs)");
            } else //TURBOPACK unreachable
            ;
        } else //TURBOPACK unreachable
        ;
    }
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/contexts/app-router-context.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['contexts'].AppRouterContext;
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/contexts/hooks-client-context.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['contexts'].HooksClientContext;
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/contexts/server-inserted-html.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['contexts'].ServerInsertedHtml;
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-dom.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].ReactDOM;
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-dev-runtime.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].ReactJsxDevRuntime;
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-jsx-runtime.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].ReactJsxRuntime;
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react-server-dom-turbopack-client.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].ReactServerDOMTurbopackClient;
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/vendored/ssr/react.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

module.exports = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/server/route-modules/app-page/module.compiled.js [app-ssr] (ecmascript)").vendored['react-ssr'].React;
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/invariant-error.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "InvariantError", {
    enumerable: true,
    get: function() {
        return InvariantError;
    }
});
class InvariantError extends Error {
    constructor(message, options){
        super(`Invariant: ${message.endsWith('.') ? message : message + '.'} This is a bug in Next.js.`, options);
        this.name = 'InvariantError';
    }
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/lazy-dynamic/bailout-to-csr.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

// This has to be a shared module which is shared between client component error boundary and dynamic component
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    BailoutToCSRError: null,
    isBailoutToCSRError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    BailoutToCSRError: function() {
        return BailoutToCSRError;
    },
    isBailoutToCSRError: function() {
        return isBailoutToCSRError;
    }
});
const BAILOUT_TO_CSR = 'BAILOUT_TO_CLIENT_SIDE_RENDERING';
class BailoutToCSRError extends Error {
    constructor(reason){
        super(`Bail out to client-side rendering: ${reason}`), this.reason = reason, this.digest = BAILOUT_TO_CSR;
    }
}
function isBailoutToCSRError(err) {
    if (typeof err !== 'object' || err === null || !('digest' in err)) {
        return false;
    }
    return err.digest === BAILOUT_TO_CSR;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/lazy-dynamic/react-browser-bailout.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

// This module is bundled separately into user code and the precompiled App
// Router runtime. Use the global symbol registry so both copies recognize the
// same browser bailout reason.
Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    createReactBrowserBailoutReason: null,
    getReactBrowserBailoutReason: null,
    isNextBrowserBailoutError: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    createReactBrowserBailoutReason: function() {
        return createReactBrowserBailoutReason;
    },
    getReactBrowserBailoutReason: function() {
        return getReactBrowserBailoutReason;
    },
    isNextBrowserBailoutError: function() {
        return isNextBrowserBailoutError;
    }
});
const REACT_BROWSER_BAILOUT_REASON = Symbol.for('next.browser-bailout-reason');
function createReactBrowserBailoutReason(reason) {
    return {
        $$typeof: REACT_BROWSER_BAILOUT_REASON,
        reason
    };
}
function getReactBrowserBailoutReason(error) {
    const cause = error?.cause;
    return cause?.$$typeof === REACT_BROWSER_BAILOUT_REASON ? cause.reason : undefined;
}
function isNextBrowserBailoutError(error) {
    return getReactBrowserBailoutReason(error) !== undefined;
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/promise-with-resolvers.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "createPromiseWithResolvers", {
    enumerable: true,
    get: function() {
        return createPromiseWithResolvers;
    }
});
function createPromiseWithResolvers() {
    // Shim of Stage 4 Promise.withResolvers proposal
    let resolve;
    let reject;
    const promise = new Promise((res, rej)=>{
        resolve = res;
        reject = rej;
    });
    return {
        resolve: resolve,
        reject: reject,
        promise
    };
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/router/utils/parse-loader-tree.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
Object.defineProperty(exports, "parseLoaderTree", {
    enumerable: true,
    get: function() {
        return parseLoaderTree;
    }
});
const _segment = __turbopack_context__.r("[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/segment.js [app-ssr] (ecmascript)");
function parseLoaderTree(tree) {
    const [segment, parallelRoutes, modules, staticSiblings] = tree;
    const { layout, template } = modules;
    let { page } = modules;
    // a __DEFAULT__ segment means that this route didn't match any of the
    // segments in the route, so we should use the default page
    page = segment === _segment.DEFAULT_SEGMENT_KEY ? modules.defaultPage : page;
    const conventionPath = layout?.[1] || template?.[1] || page?.[1];
    return {
        page,
        segment,
        modules,
        /* it can be either layout / template / page */ conventionPath,
        parallelRoutes,
        staticSiblings
    };
}
}),
"[project]/node_modules/.pnpm/next@16.4.3_@playwright+test@1.63.0_@types+node@20.19.43_react-dom@19.3.1_react@19.3.1__react@19.3.1/node_modules/next/dist/shared/lib/segment.js [app-ssr] (ecmascript)", ((__turbopack_context__, module, exports) => {
"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
0 && (module.exports = {
    DEFAULT_SEGMENT_KEY: null,
    NOT_FOUND_SEGMENT_KEY: null,
    PAGE_SEGMENT_KEY: null,
    computeSelectedLayoutSegment: null,
    getSegmentValue: null,
    getSelectedLayoutSegmentPath: null,
    isGroupSegment: null,
    isParallelRouteSegment: null
});
function _export(target, all) {
    for(var name in all)Object.defineProperty(target, name, {
        enumerable: true,
        get: all[name]
    });
}
_export(exports, {
    DEFAULT_SEGMENT_KEY: function() {
        return DEFAULT_SEGMENT_KEY;
    },
    NOT_FOUND_SEGMENT_KEY: function() {
        return NOT_FOUND_SEGMENT_KEY;
    },
    PAGE_SEGMENT_KEY: function() {
        return PAGE_SEGMENT_KEY;
    },
    computeSelectedLayoutSegment: function() {
        return computeSelectedLayoutSegment;
    },
    getSegmentValue: function() {
        return getSegmentValue;
    },
    getSelectedLayoutSegmentPath: function() {
        return getSelectedLayoutSegmentPath;
    },
    isGroupSegment: function() {
        return isGroupSegment;
    },
    isParallelRouteSegment: function() {
        return isParallelRouteSegment;
    }
});
function getSegmentValue(segment) {
    return Array.isArray(segment) ? segment[1] : segment;
}
function isGroupSegment(segment) {
    // Use array[0] for performant purpose
    return segment[0] === '(' && segment.endsWith(')');
}
function isParallelRouteSegment(segment) {
    return segment.startsWith('@') && segment !== '@children';
}
function computeSelectedLayoutSegment(segments, parallelRouteKey) {
    if (!segments || segments.length === 0) {
        return null;
    }
    // For 'children', use first segment; for other parallel routes, use last segment
    const rawSegment = parallelRouteKey === 'children' ? segments[0] : segments[segments.length - 1];
    // If the default slot is showing, return null since it's not technically "selected" (it's a fallback)
    // Returning an internal value like `__DEFAULT__` would be confusing
    return rawSegment === DEFAULT_SEGMENT_KEY ? null : rawSegment;
}
function getSelectedLayoutSegmentPath(tree, parallelRouteKey, first = true, segmentPath = []) {
    let node;
    if (first) {
        // Use the provided parallel route key on the first parallel route
        node = tree[1][parallelRouteKey];
    } else {
        // After first parallel route prefer children, if there's no children pick the first parallel route.
        const parallelRoutes = tree[1];
        node = parallelRoutes.children ?? Object.values(parallelRoutes)[0];
    }
    if (!node) return segmentPath;
    const segment = node[0];
    let segmentValue = getSegmentValue(segment);
    if (!segmentValue || segmentValue === PAGE_SEGMENT_KEY) {
        return segmentPath;
    }
    segmentPath.push(segmentValue);
    return getSelectedLayoutSegmentPath(node, parallelRouteKey, false, segmentPath);
}
const PAGE_SEGMENT_KEY = '__PAGE__';
const DEFAULT_SEGMENT_KEY = '__DEFAULT__';
const NOT_FOUND_SEGMENT_KEY = '/_not-found';
}),
];})()

//# sourceMappingURL=00p4_next_dist_0qvaxk-vxn8eq._.js.map