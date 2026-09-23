const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

let _s3 = null;

function s3() {
  if (!_s3) {
    _s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
      }
    });
  }
  return _s3;
}

async function uploadBase64(dataURL) {
  if (!dataURL) return null;
  if (!String(dataURL).startsWith('data:')) return dataURL; // já é URL pública salva antes
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataURL);
  if (!m) return null;
  const ext = m[1].split('/')[1] === 'jpeg' ? 'jpg' : m[1].split('/')[1];
  const chave = `fotos/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  await s3().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: chave,
    Body: Buffer.from(m[2], 'base64'),
    ContentType: m[1]
  }));
  return `${(process.env.R2_PUBLIC_URL || '').replace(/\/$/, '')}/${chave}`;
}

module.exports = { uploadBase64 };
