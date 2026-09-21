import express from 'express';

export function createPublicRouter({ shiftCache, tokenStore, plandayClient, frontendPollMs }) {
  const router = express.Router();

  router.get('/health', async (req, res, next) => {
    try {
      const state = shiftCache.getState();
      res.json({
        status: state.hasData ? 'ok' : 'starting',
        planday: {
          authorized: Boolean(plandayClient.config.refreshToken) || (await tokenStore.hasRefreshToken())
        },
        cache: {
          hasData: state.hasData,
          isStale: state.isStale,
          lastSuccessfulUpdate: state.lastSuccessfulUpdate,
          lastAttempt: state.lastAttempt,
          lastError: state.lastError
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/shifts', async (req, res, next) => {
    try {
      await shiftCache.refreshIfNeeded();
      res.json({
        ...shiftCache.getPublicData(),
        frontendPollMs
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}
