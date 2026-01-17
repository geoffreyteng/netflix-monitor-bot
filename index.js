// Load .env first (recommended in ESM)
import 'dotenv/config'; // loads process.env from .env
import { scanForNetflixEmails } from './netflix-bot.js';

(async () => {
    await scanForNetflixEmails();
    process.exit(0);
})();