package com.duhfreakinduh.driverguard

import android.content.Context

object FeatureSettings {
    const val PREFS = "driver_guard_feature_settings"

    const val KEY_PHONE_DETECTION = "phone_detection"
    const val KEY_VOICE_WARNINGS = "voice_warnings"
    const val KEY_VIBRATION = "vibration"
    const val KEY_ALARM_TONE = "alarm_tone"
    const val KEY_SMITH_COACH = "smith_coach"
    const val KEY_REAR_ROAD_GUARD = "rear_road_guard"
    const val KEY_ROAD_HAZARDS = "road_hazards"

    const val KEY_DRIVER_SENSITIVITY = "driver_sensitivity"
    const val KEY_CUSTOM_EYES_MS = "custom_eyes_ms"
    const val KEY_CUSTOM_MIRROR_MS = "custom_mirror_ms"
    const val KEY_CUSTOM_LOOK_DOWN_MS = "custom_look_down_ms"
    const val KEY_CUSTOM_MISSING_MS = "custom_missing_ms"

    const val KEY_TEEN_MODE = "teen_mode"
    const val KEY_TEEN_PARENT_PHONE = "teen_parent_phone"
    const val KEY_TEEN_EVENT_LIMIT = "teen_event_limit"
    const val KEY_TEEN_MAJOR_EYES = "teen_major_eyes"
    const val KEY_TEEN_MAJOR_PHONE = "teen_major_phone"
    const val KEY_TEEN_MAJOR_ROAD = "teen_major_road"
    const val KEY_TEEN_MAJOR_ALARM = "teen_major_alarm"
    const val KEY_TEEN_PIN_SALT = "teen_pin_salt"
    const val KEY_TEEN_PIN_HASH = "teen_pin_hash"

    fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(context: Context, key: String, defaultValue: Boolean = true): Boolean =
        prefs(context).getBoolean(key, defaultValue)

    fun setEnabled(context: Context, key: String, enabled: Boolean) {
        prefs(context).edit().putBoolean(key, enabled).apply()
    }

    fun string(context: Context, key: String, defaultValue: String = ""): String =
        prefs(context).getString(key, defaultValue) ?: defaultValue

    fun setString(context: Context, key: String, value: String) {
        prefs(context).edit().putString(key, value).apply()
    }

    fun int(context: Context, key: String, defaultValue: Int): Int =
        prefs(context).getInt(key, defaultValue)

    fun setInt(context: Context, key: String, value: Int) {
        prefs(context).edit().putInt(key, value).apply()
    }
}
