const { ok, fail, methodNotAllowed, readRawBody } = require('../../../lib/json');
const { getSupabaseAdmin } = require('../../../lib/supabaseAdmin');
const { asInt } = require('../../../lib/validators');

function parseMultipart(req, raw) {
  const contentType = String(req.headers?.['content-type'] || req.headers?.['Content-Type'] || '');
  const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
  if (!boundaryMatch) throw new Error('Missing multipart boundary');
  const boundary = `--${boundaryMatch[1]}`;
  const text = raw.toString('binary');
  const parts = text.split(boundary).slice(1, -1);

  const fields = {};
  let file = null;

  for (const part of parts) {
    const trimmed = part.replace(/^\r\n/, '').replace(/\r\n$/, '');
    const headerEnd = trimmed.indexOf('\r\n\r\n');
    if (headerEnd < 0) continue;

    const headerBlock = trimmed.slice(0, headerEnd);
    const bodyBlock = trimmed.slice(headerEnd + 4);
    const nameMatch = headerBlock.match(/name="([^"]+)"/i);
    if (!nameMatch) continue;

    const fieldName = nameMatch[1];
    const filenameMatch = headerBlock.match(/filename="([^"]*)"/i);

    if (filenameMatch) {
      const contentTypeMatch = headerBlock.match(/content-type:\s*([^\r\n]+)/i);
      const binaryData = Buffer.from(bodyBlock, 'binary');
      file = {
        originalname: filenameMatch[1] || 'upload.bin',
        mimetype: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
        buffer: binaryData
      };
    } else {
      fields[fieldName] = bodyBlock;
    }
  }

  return { file, fields };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'], 'v2_upload_coin_back_method');

  try {
    let file = req.file || null;
    let body = req.body || {};

    if (!file) {
      const raw = await readRawBody(req);
      if (!raw.length) {
        return fail(res, 400, 'Missing file upload', 'v2_upload_coin_back_missing_file');
      }
      const parsed = parseMultipart(req, raw);
      file = parsed.file;
      body = { ...body, ...parsed.fields };
    }

    if (!file || !file.buffer || !file.buffer.length) {
      return fail(res, 400, 'Missing file upload', 'v2_upload_coin_back_missing_file');
    }

    const tournamentId = asInt(body?.tournament_id);
    if (!tournamentId) {
      return fail(res, 400, 'tournament_id must be an integer', 'v2_upload_coin_back_invalid_tournament');
    }

    const ext = (() => {
      const fromName = (file.originalname || '').split('.').pop()?.toLowerCase();
      if (fromName && /^[a-z0-9]+$/.test(fromName)) return fromName;
      const mime = String(file.mimetype || '').toLowerCase();
      if (mime.includes('png')) return 'png';
      if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
      if (mime.includes('webp')) return 'webp';
      return 'bin';
    })();

    const path = `coin-back/tournament-${tournamentId}-${Date.now()}.${ext}`;
    const supabase = getSupabaseAdmin();
    const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'uploads';

    const uploadResult = await supabase.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype || 'application/octet-stream',
        upsert: true
      });

    if (uploadResult.error) {
      return fail(res, 500, uploadResult.error.message, 'v2_upload_coin_back_storage_upload');
    }

    const publicUrlResult = supabase.storage.from(bucket).getPublicUrl(path);
    const publicUrl = publicUrlResult?.data?.publicUrl;
    if (!publicUrl) {
      return fail(res, 500, 'Failed to build public URL', 'v2_upload_coin_back_public_url');
    }

    return ok(res, { path, public_url: publicUrl });
  } catch (error) {
    return fail(res, 500, error.message || 'Unexpected server error', 'v2_upload_coin_back_handler');
  }
};
