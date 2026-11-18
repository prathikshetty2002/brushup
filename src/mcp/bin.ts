import { main } from './server';

main().catch((err) => {
  console.error('brushup MCP server failed:', err);
  process.exit(1);
});
