package com.duhfreakinduh.driverguard

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.telephony.SmsManager
import android.util.Base64
import androidx.core.content.ContextCompat
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

object TeenModeManager {
    private const val PIN_ITERATIONS = 120_000
    private const val PIN_BITS = 256
    private const val SMS_RATE_LIMIT_MS = 30_000L

    private var issueCount = 0
    private var limitAlertSent = false
    private var lastSmsMs = 0L

    fun isEnabled(context: Context): Boolean =
        FeatureSettings.enabled(context, FeatureSettings.KEY_TEEN_MODE, false)

    fun hasPin(context: Context): Boolean =
        FeatureSettings.string(context, FeatureSettings.KEY_TEEN_PIN_HASH).isNotBlank() &&
            FeatureSettings.string(context, FeatureSettings.KEY_TEEN_PIN_SALT).isNotBlank()

    fun setPin(context: Context, pin: String): Boolean {
        if (!pin.matches(Regex("\\d{4,8}"))) return false
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
        val hash = derivePin(pin, salt)
        FeatureSettings.setString(
            context,
            FeatureSettings.KEY_TEEN_PIN_SALT,
            Base64.encodeToString(salt, Base64.NO_WRAP)
        )
        FeatureSettings.setString(
            context,
            FeatureSettings.KEY_TEEN_PIN_HASH,
            Base64.encodeToString(hash, Base64.NO_WRAP)
        )
        return true
    }

    fun verifyPin(context: Context, pin: String): Boolean {
        if (!hasPin(context)) return false
        return try {
            val salt = Base64.decode(
                FeatureSettings.string(context, FeatureSettings.KEY_TEEN_PIN_SALT),
                Base64.NO_WRAP
            )
            val expected = Base64.decode(
                FeatureSettings.string(context, FeatureSettings.KEY_TEEN_PIN_HASH),
                Base64.NO_WRAP
            )
            MessageDigest.isEqual(expected, derivePin(pin, salt))
        } catch (_: Exception) {
            false
        }
    }

    fun beginDrive() {
        issueCount = 0
        limitAlertSent = false
        lastSmsMs = 0L
    }

    fun endDrive() {
        // Counters are scoped to the active drive and reset on the next start.
    }

    fun eventCount(): Int = issueCount

    fun onEvent(context: Context, type: String, triggers: Collection<DriverTrigger>): String? {
        if (!isEnabled(context)) return null

        val triggerSet = triggers.toSet()
        val countable = type == "warning" || type == "phone_detected"
        if (countable) issueCount += 1

        val majorReason = when {
            type == "alarm" && FeatureSettings.enabled(
                context,
                FeatureSettings.KEY_TEEN_MAJOR_ALARM,
                true
            ) -> "Driver Guard alarm: ${labels(triggerSet)}"

            DriverTrigger.PHONE_VISIBLE in triggerSet &&
                type in setOf("phone_detected", "warning", "alarm") &&
                FeatureSettings.enabled(context, FeatureSettings.KEY_TEEN_MAJOR_PHONE, true) ->
                "Phone detected while driving"

            DriverTrigger.EYES_CLOSED in triggerSet &&
                type == "alarm" &&
                FeatureSettings.enabled(context, FeatureSettings.KEY_TEEN_MAJOR_EYES, true) ->
                "Sustained eyes-closed alarm"

            else -> null
        }

        if (majorReason != null) {
            return sendParentAlert(
                context,
                "Driver Guard TEEN ALERT: MAJOR - $majorReason. Drive issue count: $issueCount."
            )
        }

        return checkIssueLimit(context)
    }

    fun onRoadHazard(context: Context, label: String, risk: RoadRisk): String? {
        if (!isEnabled(context)) return null
        issueCount += 1
        if (risk == RoadRisk.HAZARD && FeatureSettings.enabled(context, FeatureSettings.KEY_TEEN_MAJOR_ROAD, true)) {
            return sendParentAlert(
                context,
                "Driver Guard TEEN ALERT: MAJOR - Road Guard detected $label in the forward lane. Drive issue count: $issueCount."
            )
        }
        return checkIssueLimit(context)
    }

    fun sendTestAlert(context: Context): String = sendParentAlert(
        context,
        "Driver Guard Teen Mode test alert. Parent notifications are configured on this phone.",
        bypassRateLimit = true
    )

    private fun checkIssueLimit(context: Context): String? {
        val limit = FeatureSettings.int(context, FeatureSettings.KEY_TEEN_EVENT_LIMIT, 3).coerceIn(1, 20)
        if (!limitAlertSent && issueCount >= limit) {
            limitAlertSent = true
            return sendParentAlert(
                context,
                "Driver Guard TEEN ALERT: $issueCount driving warnings/issues have occurred in this drive. Please check in with the driver."
            )
        }
        return null
    }

    private fun sendParentAlert(
        context: Context,
        message: String,
        bypassRateLimit: Boolean = false
    ): String {
        val phone = FeatureSettings.string(context, FeatureSettings.KEY_TEEN_PARENT_PHONE)
            .filter { it.isDigit() || it == '+' }
        if (phone.length < 7) return "Parent phone number is not configured"

        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            return "SMS permission is not granted"
        }

        val now = System.currentTimeMillis()
        if (!bypassRateLimit && now - lastSmsMs < SMS_RATE_LIMIT_MS) {
            return "Parent alert rate-limited"
        }

        return try {
            @Suppress("DEPRECATION")
            SmsManager.getDefault().sendTextMessage(phone, null, message.take(155), null, null)
            lastSmsMs = now
            "Parent SMS sent"
        } catch (e: Exception) {
            "Parent SMS failed: ${e.message ?: e.javaClass.simpleName}"
        }
    }

    private fun labels(triggers: Set<DriverTrigger>): String =
        triggers.joinToString(" • ") { it.label }.ifBlank { "driver safety event" }

    private fun derivePin(pin: String, salt: ByteArray): ByteArray {
        val spec = PBEKeySpec(pin.toCharArray(), salt, PIN_ITERATIONS, PIN_BITS)
        return try {
            SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256").generateSecret(spec).encoded
        } finally {
            spec.clearPassword()
        }
    }
}
