-- Keep historical appointment and application states aligned with the command rules.
UPDATE appointments AS appointment
SET status = 'CANCELLED',
    "statusNote" = COALESCE(application."statusNote", appointment."statusNote", '对应报名已取消'),
    "handledAt" = COALESCE(application."handledAt", NOW()),
    version = appointment.version + 1,
    "updatedAt" = NOW()
FROM applications AS application
WHERE application.id = appointment."applicationId"
  AND application.status = 'CANCELLED'
  AND appointment.status IN ('PENDING', 'CONFIRMED', 'DISPUTED');
