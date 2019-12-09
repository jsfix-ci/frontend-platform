/**
 * The initialization module provides a function for managing an application's initialization
 * lifecycle.  It also provides constants and default handler implementations.
 *
 * @module Initialization
 */

import { createBrowserHistory } from 'history';
import {
  publish,
} from './pubSub';
import {
  getConfig,
} from './config';
import { configure as configureLogging, getLoggingService, NewRelicLoggingService, logError } from './logging';
import { configure as configureAnalytics, SegmentAnalyticsService, identifyAnonymousUser, identifyAuthenticatedUser } from './analytics';
import { getAuthenticatedHttpClient, configure as configureAuth, ensureAuthenticatedUser, fetchAuthenticatedUser, hydrateAuthenticatedUser, getAuthenticatedUser } from './auth';
import { configure as configureI18n } from './i18n';

export const APP_TOPIC = 'APP';
export const APP_PUBSUB_INITIALIZED = `${APP_TOPIC}.PUBSUB_INITIALIZED`;
export const APP_CONFIG_INITIALIZED = `${APP_TOPIC}.CONFIG_INITIALIZED`;
export const APP_AUTH_INITIALIZED = `${APP_TOPIC}.AUTH_INITIALIZED`;
export const APP_I18N_INITIALIZED = `${APP_TOPIC}.I18N_INITIALIZED`;
export const APP_LOGGING_INITIALIZED = `${APP_TOPIC}.LOGGING_INITIALIZED`;
export const APP_ANALYTICS_INITIALIZED = `${APP_TOPIC}.ANALYTICS_INITIALIZED`;
export const APP_READY = `${APP_TOPIC}.READY`;
export const APP_INIT_ERROR = `${APP_TOPIC}.INIT_ERROR`;

/**
 * A browser history object created by the [history](https://github.com/ReactTraining/history)
 * package.  Applications are encouraged to use this history object, rather than creating their own,
 * as behavior may be undefined when managing history via multiple mechanisms/instances.
 *
 * @memberof module:Utilities
 */
export const history = createBrowserHistory();

/**
 * @memberof module:Initialization
 * @param {*} error
 */
export async function initError(error) {
  logError(error);
}

/**
 * The default handler for the initialization lifecycle's `auth` phase.
 *
 * The handler has several responsibilities:
 * - Determining the user's authentication state (authenticated or anonymous)
 * - Optionally redirecting to login if the application requires an authenticated user.
 * - Optionally loading additional user information via the application's user account data
 * endpoint.
 *
 * @memberof module:Initialization
 * @param {boolean} requireUser Whether or not we should redirect to login if a user is not
 * authenticated.
 * @param {boolean} hydrateUser Whether or not we should fetch additional user account data.
 */
export async function auth(requireUser, hydrateUser) {
  if (requireUser) {
    await ensureAuthenticatedUser(global.location.href);
  } else {
    await fetchAuthenticatedUser();
  }

  if (hydrateUser && getAuthenticatedUser() !== null) {
    // We intentionally do not await the promise returned by hydrateAuthenticatedUser. All the
    // critical data is returned as part of fetch/ensureAuthenticatedUser above, and anything else
    // is a nice-to-have for application code.
    hydrateAuthenticatedUser();
  }
}


/**
 * The default handler for the initialization lifecycle's `analytics` phase.
 *
 * The handler is responsible for identifying authenticated and anonymous users with the analytics
 * service.  This is a pre-requisite for sending analytics events, thus, we do it during the
 * initialization sequence so that analytics is ready once the application's UI code starts to load.
 *
 * @memberof module:Initialization
 */
export async function analytics() {
  const authenticatedUser = getAuthenticatedUser();
  if (authenticatedUser && authenticatedUser.userId) {
    identifyAuthenticatedUser(authenticatedUser.userId);
  } else {
    identifyAnonymousUser();
  }
}

function applyOverrideHandlers(overrides) {
  const noOp = async () => {};
  return {
    pubSub: noOp,
    config: noOp,
    logging: noOp,
    auth,
    analytics,
    i18n: noOp,
    ready: noOp,
    initError,
    ...overrides, // This will override any same-keyed handlers from above.
  };
}

/**
 * Invokes the application initialization sequence.
 *
 *
 * @memberof module:Initialization
 * @param {Object} [options]
 * @param {*} [options.loggingService=NewRelicLoggingService] The `LoggingService` implementation
 * to use.
 * @param {*} [options.analyticsService=SegmentAnalyticsService] The `AnalyticsService`
 * implementation to use.
 * @param {*} [options.requireAuthenticatedUser=false] If true, turns on automatic login
 * redirection for unauthenticated users.  Defaults to false, meaning that by default the
 * application will allow anonymous/unauthenticated sessions.
 * @param {*} [options.hydrateAuthenticatedUser=false] If true, makes an API call to the user
 * account endpoint (`${App.config.LMS_BASE_URL}/api/user/v1/accounts/${username}`) to fetch
 * detailed account information for the authenticated user. This data is merged into the return
 * value of `getAuthenticatedUser`, overriding any duplicate keys that already exist. Defaults to
 * false, meaning that no additional account information will be loaded.
 * @param {*} [options.messages] A i18n-compatible messages object, or an array of such objects. If
 * an array is provided, duplicate keys are resolved with the last-one-in winning.
 * @param {*} [options.handlers={}] An optional object of handlers which can be used to replace the
 * default behavior of any part of the startup sequence. It can also be used to add additional
 * initialization behavior before or after the rest of the sequence.
 */
export async function initialize({
  loggingService = NewRelicLoggingService,
  analyticsService = SegmentAnalyticsService,
  requireAuthenticatedUser: requireUser = false,
  hydrateAuthenticatedUser: hydrateUser = false,
  messages,
  handlers: overrideHandlers = {},
}) {
  const handlers = applyOverrideHandlers(overrideHandlers);
  try {
    // Pub/Sub
    await handlers.pubSub();
    publish(APP_PUBSUB_INITIALIZED);

    // Configuration
    await handlers.config();
    publish(APP_CONFIG_INITIALIZED);

    // Logging
    configureLogging(loggingService, {
      config: getConfig(),
    });
    await handlers.logging();
    publish(APP_LOGGING_INITIALIZED);

    // Authentication
    configureAuth({
      loggingService: getLoggingService(),
      appBaseUrl: getConfig().BASE_URL,
      lmsBaseUrl: getConfig().LMS_BASE_URL,
      loginUrl: getConfig().LOGIN_URL,
      logoutUrl: getConfig().LOGIN_URL,
      refreshAccessTokenEndpoint: getConfig().REFRESH_ACCESS_TOKEN_ENDPOINT,
      accessTokenCookieName: getConfig().ACCESS_TOKEN_COOKIE_NAME,
      csrfTokenApiPath: getConfig().CSRF_TOKEN_API_PATH,
    });
    await handlers.auth(requireUser, hydrateUser);
    publish(APP_AUTH_INITIALIZED);

    // Analytics
    configureAnalytics(analyticsService, {
      config: getConfig(),
      loggingService: getLoggingService(),
      httpClient: getAuthenticatedHttpClient(),
    });
    await handlers.analytics();
    publish(APP_ANALYTICS_INITIALIZED);

    // Internationalization
    configureI18n({
      messages,
      config: getConfig(),
      loggingService: getLoggingService(),
    });
    await handlers.i18n();
    publish(APP_I18N_INITIALIZED);

    // Application Ready
    await handlers.ready();
    publish(APP_READY);
  } catch (error) {
    if (!error.isRedirecting) {
      // Initialization Error
      await handlers.initError(error);
      publish(APP_INIT_ERROR, error);
    }
  }
}
