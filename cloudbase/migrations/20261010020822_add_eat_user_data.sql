CREATE TABLE eat_user_data (
  openid     TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE eat_user_data ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE eat_user_data IS '今天吃什么 - 用户数据（口味/收藏/历史），按微信 openid 归属，仅经云函数访问'
