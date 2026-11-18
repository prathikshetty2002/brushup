import { main } from './server';

main().catch((err) => {
  console.error('ascend MCP server failed:', err);
  process.exit(1);
});
