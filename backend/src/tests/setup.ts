// Global test setup
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test_db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.JWT_SECRET = 'test_jwt_secret_at_least_32_characters_long';
process.env.JWT_REFRESH_SECRET = 'test_refresh_secret_32_characters_long__';
process.env.ENCRYPTION_KEY = 'test_encryption_key_32characters';
process.env.JWT_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.NODE_ENV = 'test';
process.env.PORT = '4001';
process.env.SMTP_HOST = 'localhost';
process.env.EMAIL_FROM = 'test@example.com';
process.env.SANDBOX_KEY_PREFIX = 'sk_test_';
process.env.LIVE_KEY_PREFIX = 'sk_live_';
