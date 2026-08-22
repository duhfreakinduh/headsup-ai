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

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(context: Context, key: String, defaultValue: Boolean = true): Boolean =
        prefs(context).getBoolean(key, defaultValue)

    fun setEnabled(context: Context, key: String, enabled: Boolean) {
        prefs(context).edit().putBoolean(key, enabled).apply()
    }
}
