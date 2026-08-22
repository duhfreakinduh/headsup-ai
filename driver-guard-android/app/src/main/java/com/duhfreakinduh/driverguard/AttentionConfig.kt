package com.duhfreakinduh.driverguard

import android.content.Context

enum class DriverSensitivity(val storageValue: String, val label: String) {
    RELAXED("relaxed", "RELAXED"),
    NORMAL("normal", "NORMAL"),
    SENSITIVE("sensitive", "SENSITIVE"),
    CUSTOM("custom", "CUSTOM");

    companion object {
        fun fromStorage(value: String): DriverSensitivity =
            entries.firstOrNull { it.storageValue == value.lowercase() } ?: NORMAL
    }
}

data class AttentionConfig(
    val mode: DriverSensitivity,
    val eyeTriggerMs: Float,
    val horizontalAwayTriggerMs: Float,
    val verticalAwayTriggerMs: Float,
    val missingTriggerMs: Float,
    val yawDeadZone: Float,
    val pitchDeadZone: Float,
    val strongSideTurnYaw: Float
) {
    companion object {
        fun fromContext(context: Context): AttentionConfig {
            val mode = DriverSensitivity.fromStorage(
                FeatureSettings.string(
                    context,
                    FeatureSettings.KEY_DRIVER_SENSITIVITY,
                    DriverSensitivity.NORMAL.storageValue
                )
            )
            return when (mode) {
                DriverSensitivity.RELAXED -> AttentionConfig(
                    mode = mode,
                    eyeTriggerMs = 1800f,
                    horizontalAwayTriggerMs = 7000f,
                    verticalAwayTriggerMs = 5000f,
                    missingTriggerMs = 6000f,
                    yawDeadZone = 0.19f,
                    pitchDeadZone = 0.25f,
                    strongSideTurnYaw = 0.15f
                )

                DriverSensitivity.NORMAL -> AttentionConfig(
                    mode = mode,
                    eyeTriggerMs = 1500f,
                    horizontalAwayTriggerMs = 5500f,
                    verticalAwayTriggerMs = 3500f,
                    missingTriggerMs = 4500f,
                    yawDeadZone = 0.17f,
                    pitchDeadZone = 0.22f,
                    strongSideTurnYaw = 0.14f
                )

                DriverSensitivity.SENSITIVE -> AttentionConfig(
                    mode = mode,
                    eyeTriggerMs = 1100f,
                    horizontalAwayTriggerMs = 3800f,
                    verticalAwayTriggerMs = 2800f,
                    missingTriggerMs = 3200f,
                    yawDeadZone = 0.14f,
                    pitchDeadZone = 0.18f,
                    strongSideTurnYaw = 0.12f
                )

                DriverSensitivity.CUSTOM -> AttentionConfig(
                    mode = mode,
                    eyeTriggerMs = FeatureSettings.int(context, FeatureSettings.KEY_CUSTOM_EYES_MS, 1500)
                        .coerceIn(800, 3000).toFloat(),
                    horizontalAwayTriggerMs = FeatureSettings.int(context, FeatureSettings.KEY_CUSTOM_MIRROR_MS, 5500)
                        .coerceIn(2000, 8000).toFloat(),
                    verticalAwayTriggerMs = FeatureSettings.int(context, FeatureSettings.KEY_CUSTOM_LOOK_DOWN_MS, 3500)
                        .coerceIn(1500, 8000).toFloat(),
                    missingTriggerMs = FeatureSettings.int(context, FeatureSettings.KEY_CUSTOM_MISSING_MS, 4500)
                        .coerceIn(2000, 8000).toFloat(),
                    yawDeadZone = 0.17f,
                    pitchDeadZone = 0.22f,
                    strongSideTurnYaw = 0.14f
                )
            }
        }
    }
}
