import { createApp } from './src/app.js';
import { createSolana } from './src/solana.js';
import { createMarket } from './src/market.js';
import { isDemo } from './src/settings.js';

const env = process.env;
const port = Number(env.PORT || 3000);
const { app } = createApp({
  env,
  solana: createSolana({ rpcUrl: env.SOLANA_RPC_URL, demo: isDemo(env) }),
  market: createMarket(),
});

app.listen(port, () => {
  console.log(`Ansemmas site listening on ${port}`);
});
