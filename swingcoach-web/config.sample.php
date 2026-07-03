<?php
/* SwingCoach server configuration.
 *
 * Copy this file to config.php and fill it in. config.php is gitignored —
 * it holds secrets and must never be committed.
 */

// From the DreamHost panel → Websites → MySQL Databases.
// (For local testing you can instead set DB_HOST to 'sqlite:/path/to/dev.sqlite'
// and leave the other DB_ fields as-is.)
define('DB_HOST', 'mysql.yoursite.com');
define('DB_NAME', 'swingcoach');
define('DB_USER', 'swingcoach_user');
define('DB_PASS', 'CHANGE_ME');

// The same OAuth client ID used in auth.js.
define('GOOGLE_CLIENT_ID', 'YOUR_CLIENT_ID.apps.googleusercontent.com');

// The only Google accounts allowed to sign in. Enforced server-side.
define('ALLOWED_EMAILS', [
    'dgbradl@gmail.com',
    'jacksoncooperbradl@gmail.com',
]);

// Optional: enables the AI coach for signed-in users. The key never leaves
// the server. Leave '' to disable the feature.
define('ANTHROPIC_API_KEY', '');
