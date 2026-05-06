-- 公开存储桶：Seedance 本地上传素材
--
-- ⚠️ 有意设计为 public=true（经评估后决策）：
-- Seedance 素材需要生成可被火山方舟（Volcano Ark）外部 AI 服务抓取的公网 URL，
-- 私有桶 + signed URL 无法满足外部服务异步拉取的需求。
-- 上传限制：仅已登录用户可上传，且路径强制为 {auth.uid()}/... 防止跨用户覆盖。
-- 如产品需求变更（素材不再需要外部可读），将 public 改为 false 并在 API 层改用 createSignedUrl。

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
