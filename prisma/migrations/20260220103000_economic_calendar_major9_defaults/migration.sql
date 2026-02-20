UPDATE "economic_calendar_config"
SET "currencies" = 'USD,EUR,GBP,JPY,CHF,CAD,AUD,NZD,CNY'
WHERE "currencies" IS NULL
   OR btrim("currencies") = ''
   OR "currencies" = 'USD,EUR';
