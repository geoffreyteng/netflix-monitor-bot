require('dotenv').config();
const fs = require('fs');
const { google } = require('googleapis');

const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];

const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
);

async function main() {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
    });
    console.log('Open this URL in your browser:\n', url);

    process.stdout.write('\nPaste the code here: ');
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', async (code) => {
        const { tokens } = await oauth2Client.getToken(code.trim());
        fs.writeFileSync('gmail-token.json', JSON.stringify(tokens, null, 2));
        console.log('Saved gmail-token.json');
        process.exit(0);
    });
}

main().catch((e) => console.error(e));
