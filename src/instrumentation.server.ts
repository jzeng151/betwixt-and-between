import * as Sentry from '@sentry/sveltekit';

Sentry.init({
  dsn: 'https://dcebe158ac92ab396cbe9c9e2991329d@o4511287279878144.ingest.us.sentry.io/4511287291215872',

  tracesSampleRate: 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: import.meta.env.DEV,
});