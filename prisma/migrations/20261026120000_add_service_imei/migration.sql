-- Optional IMEI per device row. Nullable on purpose: existing jobs keep NULL
-- and every form/API path still saves without it.
ALTER TABLE "Service" ADD COLUMN "imei" TEXT;
