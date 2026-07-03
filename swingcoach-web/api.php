<?php
/* SwingCoach API: Google-verified sessions, shot storage, AI proxy.
 *
 * One endpoint, JSON POST bodies, action-based routing:
 *   login   {credential}          -> {token, email, expires, ai}
 *   logout  {token}
 *   list    {token}               -> {shots: [...], ai}
 *   upsert  {token, shot}
 *   delete  {token, id}
 *   ai      {token, shot, handedness} -> {advice}
 *
 * Auth is enforced here, server-side: login verifies the Google ID token via
 * Google's tokeninfo endpoint (audience, verified email, allowlist), then
 * issues an opaque session token with a sliding 30-day expiry. Every other
 * action requires that token. All shots are scoped to the session's email.
 */

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

require __DIR__ . '/config.php';

// Overridable so tests can point at a stub; production never sets this.
if (!defined('GOOGLE_TOKENINFO_URL')) {
    define('GOOGLE_TOKENINFO_URL', 'https://oauth2.googleapis.com/tokeninfo');
}

const SESSION_DAYS = 30;
const MAX_SHOTS_RETURNED = 500;
const MAX_NOTE_CHARS = 2000;

const VALID_FIELDS = [
    'club'       => ['driver', 'fairwayWood', 'hybrid', 'longIron', 'midIron', 'shortIron', 'wedge'],
    'startLine'  => ['left', 'straight', 'right'],
    'curve'      => ['hook', 'draw', 'straight', 'fade', 'slice'],
    'contact'    => ['flush', 'thin', 'fat', 'topped', 'toe', 'heel', 'shank'],
    'trajectory' => ['low', 'normal', 'high'],
];

// Human-readable labels for the AI prompt (mirror engine.js).
const LABELS = [
    'club' => [
        'driver' => 'Driver', 'fairwayWood' => 'Fairway wood', 'hybrid' => 'Hybrid',
        'longIron' => 'Long iron (2–4)', 'midIron' => 'Mid iron (5–7)',
        'shortIron' => 'Short iron (8–9)', 'wedge' => 'Wedge',
    ],
    'startLine' => ['left' => 'Left', 'straight' => 'Straight', 'right' => 'Right'],
    'curve' => [
        'hook' => 'Big hook', 'draw' => 'Draw', 'straight' => 'Straight',
        'fade' => 'Fade', 'slice' => 'Big slice',
    ],
    'contact' => [
        'flush' => 'Flush', 'thin' => 'Thin', 'fat' => 'Fat / chunked', 'topped' => 'Topped',
        'toe' => 'Off the toe', 'heel' => 'Off the heel', 'shank' => 'Shank',
    ],
    'trajectory' => ['low' => 'Low', 'normal' => 'Normal', 'high' => 'Ballooned / high'],
];

function fail(int $code, string $msg): never
{
    http_response_code($code);
    echo json_encode(['error' => $msg]);
    exit;
}

function now(): string
{
    return gmdate('Y-m-d H:i:s');
}

function plus_days(int $days): string
{
    return gmdate('Y-m-d H:i:s', time() + $days * 86400);
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo !== null) {
        return $pdo;
    }
    $dsn = str_starts_with(DB_HOST, 'sqlite:')
        ? DB_HOST
        : 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=utf8mb4';
    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]);
    } catch (PDOException $e) {
        fail(500, 'Database connection failed — check config.php');
    }
    // Generic DDL that works on both MySQL (DreamHost) and SQLite (local tests).
    $pdo->exec('CREATE TABLE IF NOT EXISTS shots (
        id CHAR(36) NOT NULL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        shot_date DATETIME NOT NULL,
        data TEXT NOT NULL
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS sessions (
        token CHAR(64) NOT NULL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        expires DATETIME NOT NULL
    )');
    return $pdo;
}

/** @return array{int, array} [http status, decoded json] */
function http_json(string $url, ?array $postJson = null, array $headers = []): array
{
    $ch = curl_init($url);
    $opts = [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120];
    if ($postJson !== null) {
        $opts[CURLOPT_POST] = true;
        $opts[CURLOPT_POSTFIELDS] = json_encode($postJson);
        $headers[] = 'Content-Type: application/json';
    }
    if ($headers) {
        $opts[CURLOPT_HTTPHEADER] = $headers;
    }
    curl_setopt_array($ch, $opts);
    $res = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($res === false) {
        return [0, []];
    }
    $json = json_decode((string) $res, true);
    return [$status, is_array($json) ? $json : []];
}

function is_allowed(string $email): bool
{
    foreach (ALLOWED_EMAILS as $allowed) {
        if (strtolower($allowed) === strtolower($email)) {
            return true;
        }
    }
    return false;
}

function require_session(PDO $pdo, array $body): string
{
    $token = $body['token'] ?? '';
    if (!is_string($token) || !preg_match('/^[0-9a-f]{64}$/', $token)) {
        fail(401, 'Not signed in');
    }
    $st = $pdo->prepare('SELECT email FROM sessions WHERE token = ? AND expires > ?');
    $st->execute([$token, now()]);
    $email = $st->fetchColumn();
    if (!is_string($email) || $email === '' || !is_allowed($email)) {
        fail(401, 'Session expired — sign in again');
    }
    // Sliding renewal: stays valid as long as the app is used within 30 days.
    $pdo->prepare('UPDATE sessions SET expires = ? WHERE token = ?')
        ->execute([plus_days(SESSION_DAYS), $token]);
    return $email;
}

/** Validate an incoming shot and return the canonical form we store. */
function clean_shot(mixed $shot): array
{
    if (!is_array($shot)) {
        fail(400, 'Missing shot');
    }
    $id = $shot['id'] ?? '';
    if (!is_string($id) || !preg_match('/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/', $id)) {
        fail(400, 'Bad shot id');
    }
    $clean = ['id' => strtolower($id)];
    foreach (VALID_FIELDS as $field => $values) {
        $v = $shot[$field] ?? '';
        if (!in_array($v, $values, true)) {
            fail(400, "Bad value for $field");
        }
        $clean[$field] = $v;
    }
    $ts = strtotime((string) ($shot['date'] ?? ''));
    $clean['date'] = gmdate('c', $ts ?: time());
    $clean['note'] = mb_substr(trim((string) ($shot['note'] ?? '')), 0, MAX_NOTE_CHARS);
    return $clean;
}

/* ------------------------------------------------------------------ main */

$body = json_decode((string) file_get_contents('php://input'), true);
if (!is_array($body)) {
    fail(400, 'Expected a JSON body');
}
$action = $body['action'] ?? '';
$pdo = db();

switch ($action) {

    case 'login': {
        $credential = $body['credential'] ?? '';
        if (!is_string($credential) || $credential === '') {
            fail(400, 'Missing credential');
        }
        [$status, $info] = http_json(GOOGLE_TOKENINFO_URL . '?id_token=' . urlencode($credential));
        if ($status !== 200) {
            fail(401, 'Google sign-in could not be verified');
        }
        if (($info['aud'] ?? '') !== GOOGLE_CLIENT_ID) {
            fail(401, 'Sign-in token is for a different app');
        }
        if (($info['email_verified'] ?? '') !== 'true') {
            fail(401, 'This Google account has no verified email');
        }
        $email = strtolower((string) ($info['email'] ?? ''));
        if ($email === '' || !is_allowed($email)) {
            fail(403, ($email ?: 'This account') . ' is not on the allowed list for this app');
        }

        $pdo->prepare('DELETE FROM sessions WHERE expires < ?')->execute([now()]);
        $token = bin2hex(random_bytes(32));
        $pdo->prepare('INSERT INTO sessions (token, email, expires) VALUES (?, ?, ?)')
            ->execute([$token, $email, plus_days(SESSION_DAYS)]);

        echo json_encode([
            'token' => $token,
            'email' => $email,
            'expires' => (time() + SESSION_DAYS * 86400) * 1000,
            'ai' => ANTHROPIC_API_KEY !== '',
        ]);
        break;
    }

    case 'logout': {
        $token = $body['token'] ?? '';
        if (is_string($token) && preg_match('/^[0-9a-f]{64}$/', $token)) {
            $pdo->prepare('DELETE FROM sessions WHERE token = ?')->execute([$token]);
        }
        echo json_encode(['ok' => true]);
        break;
    }

    case 'list': {
        $email = require_session($pdo, $body);
        $st = $pdo->prepare('SELECT data FROM shots WHERE email = ? ORDER BY shot_date DESC LIMIT ' . MAX_SHOTS_RETURNED);
        $st->execute([$email]);
        $shots = array_map(fn($row) => json_decode($row['data'], true), $st->fetchAll());
        echo json_encode(['shots' => $shots, 'ai' => ANTHROPIC_API_KEY !== '']);
        break;
    }

    case 'upsert': {
        $email = require_session($pdo, $body);
        $shot = clean_shot($body['shot'] ?? null);

        $st = $pdo->prepare('SELECT email FROM shots WHERE id = ?');
        $st->execute([$shot['id']]);
        $owner = $st->fetchColumn();
        if (is_string($owner) && $owner !== '' && $owner !== $email) {
            fail(403, 'That shot belongs to a different account');
        }

        // REPLACE works on both MySQL and SQLite; ownership was checked above.
        $pdo->prepare('REPLACE INTO shots (id, email, shot_date, data) VALUES (?, ?, ?, ?)')
            ->execute([
                $shot['id'],
                $email,
                gmdate('Y-m-d H:i:s', strtotime($shot['date'])),
                json_encode($shot),
            ]);
        echo json_encode(['ok' => true]);
        break;
    }

    case 'delete': {
        $email = require_session($pdo, $body);
        $id = strtolower((string) ($body['id'] ?? ''));
        $pdo->prepare('DELETE FROM shots WHERE id = ? AND email = ?')->execute([$id, $email]);
        echo json_encode(['ok' => true]);
        break;
    }

    case 'ai': {
        require_session($pdo, $body);
        if (ANTHROPIC_API_KEY === '') {
            fail(501, 'The AI coach is not configured on the server');
        }
        $shot = clean_shot($body['shot'] ?? null);
        $handedness = ($body['handedness'] ?? 'right') === 'left' ? 'Left-handed' : 'Right-handed';

        $lines = [
            "Golfer: $handedness.",
            'Club: ' . LABELS['club'][$shot['club']] . '.',
            'Contact: ' . LABELS['contact'][$shot['contact']] . '.',
            'Start line: ' . LABELS['startLine'][$shot['startLine']] . ' of target line.',
            'Curve: ' . LABELS['curve'][$shot['curve']] . '.',
            'Trajectory: ' . LABELS['trajectory'][$shot['trajectory']] . '.',
        ];
        if ($shot['note'] !== '') {
            $lines[] = "Golfer's own description: " . $shot['note'];
        }

        [$status, $resp] = http_json('https://api.anthropic.com/v1/messages', [
            'model' => 'claude-opus-4-8',
            'max_tokens' => 1024,
            'system' => 'You are a friendly, expert golf instructor. The golfer will describe one shot. '
                . 'Give practical, encouraging advice about the most likely swing cause and ONE specific '
                . 'thing to work on, with a drill. Be concise (under 200 words), use plain language, and '
                . 'never blame the golfer.',
            'messages' => [['role' => 'user', 'content' => implode("\n", $lines)]],
        ], [
            'x-api-key: ' . ANTHROPIC_API_KEY,
            'anthropic-version: 2023-06-01',
        ]);

        if ($status !== 200) {
            fail(502, $resp['error']['message'] ?? 'The AI request failed');
        }
        if (($resp['stop_reason'] ?? '') === 'refusal') {
            fail(502, 'The AI declined to answer this request');
        }
        $text = implode("\n", array_map(
            fn($block) => $block['text'] ?? '',
            array_filter($resp['content'] ?? [], fn($block) => ($block['type'] ?? '') === 'text')
        ));
        if (trim($text) === '') {
            fail(502, 'The AI returned an empty answer');
        }
        echo json_encode(['advice' => $text]);
        break;
    }

    default:
        fail(400, 'Unknown action');
}
