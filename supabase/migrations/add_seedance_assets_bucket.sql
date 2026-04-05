-- 公开存储桶：Seedance 本地上传素材
-- 用于将本地图片 / 视频 / 音频上传后生成公网 URL，供火山方舟抓取。

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'seedance-assets',
  'seedance-assets',
  true,
  524288000,
  ARRAY[
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/quicktime',
    'video/webm',
    'video/x-matroska',
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/aac',
    'audio/webm'
  ]::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public read seedance assets" ON storage.objects;
DROP POLICY IF EXISTS "Users upload own seedance assets" ON storage.objects;
DROP POLICY IF EXISTS "Users update own seedance assets" ON storage.objects;
DROP POLICY IF EXISTS "Users delete own seedance assets" ON storage.objects;

CREATE POLICY "Public read seedance assets"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'seedance-assets');

CREATE POLICY "Users upload own seedance assets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'seedance-assets'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "Users update own seedance assets"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'seedance-assets'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

CREATE POLICY "Users delete own seedance assets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'seedance-assets'
    AND split_part(name, '/', 1) = auth.uid()::text
  );
