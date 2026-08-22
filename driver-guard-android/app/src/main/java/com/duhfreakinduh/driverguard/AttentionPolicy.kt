package com.duhfreakinduh.driverguard

import kotlin.math.max

enum class DriverTrigger(val label: String) {
    EYES_CLOSED("eyes closed"),
    HEAD_TURNED("head turned"),
    LOOKING_UP_DOWN("looking up/down"),
    FACE_MISSING("face missing"),
    PHONE_VISIBLE("phone visible")
}

data class PolicyInput(
    val hasFace: Boolean,
    val rawEyesClosed: Boolean,
    val rawAway: Boolean,
    val pitchDominant: Boolean = false
)

data class PolicyDecision(
    val triggers: Set<DriverTrigger>,
    val eyeEvidenceMs: Float,
    val awayEvidenceMs: Float,
    val horizontalAwayEvidenceMs: Float,
    val verticalAwayEvidenceMs: Float,
    val missingEvidenceMs: Float,
    val eyeTriggerMs: Float,
    val awayTriggerMs: Float,
    val missingTriggerMs: Float,
    val rawEyesClosed: Boolean,
    val rawAway: Boolean
)

class AttentionPolicy(
    private var config: AttentionConfig = AttentionConfig(
        mode = DriverSensitivity.NORMAL,
        eyeTriggerMs = 1500f,
        horizontalAwayTriggerMs = 5500f,
        verticalAwayTriggerMs = 3500f,
        missingTriggerMs = 4500f,
        yawDeadZone = 0.17f,
        pitchDeadZone = 0.22f,
        strongSideTurnYaw = 0.14f
    )
) {
    private var lastTimestampMs: Long? = null
    private var eyeEvidenceMs = 0f
    private var horizontalAwayEvidenceMs = 0f
    private var verticalAwayEvidenceMs = 0f
    private var missingEvidenceMs = 0f

    fun reconfigure(newConfig: AttentionConfig) {
        config = newConfig
        reset()
    }

    fun reset() {
        lastTimestampMs = null
        eyeEvidenceMs = 0f
        horizontalAwayEvidenceMs = 0f
        verticalAwayEvidenceMs = 0f
        missingEvidenceMs = 0f
    }

    fun update(input: PolicyInput, timestampMs: Long): PolicyDecision {
        // Cap frame gaps so a stalled camera frame cannot create several seconds of
        // synthetic evidence when processing resumes.
        val dt = lastTimestampMs?.let { (timestampMs - it).coerceIn(16L, 150L).toFloat() } ?: 65f
        lastTimestampMs = timestampMs

        if (!input.hasFace) {
            missingEvidenceMs = (missingEvidenceMs + dt)
                .coerceAtMost(config.missingTriggerMs + 3000f)
            eyeEvidenceMs = decay(eyeEvidenceMs, dt, 8f)
            horizontalAwayEvidenceMs = decay(horizontalAwayEvidenceMs, dt, 9f)
            verticalAwayEvidenceMs = decay(verticalAwayEvidenceMs, dt, 9f)
        } else {
            missingEvidenceMs = decay(missingEvidenceMs, dt, 9f)

            eyeEvidenceMs = if (input.rawEyesClosed) {
                (eyeEvidenceMs + dt).coerceAtMost(config.eyeTriggerMs + 2500f)
            } else {
                decay(eyeEvidenceMs, dt, 8f)
            }

            when {
                input.rawAway && input.pitchDominant -> {
                    verticalAwayEvidenceMs = (verticalAwayEvidenceMs + dt)
                        .coerceAtMost(config.verticalAwayTriggerMs + 3500f)
                    // A mirror/shoulder scan must not preload the shorter look-down timer.
                    horizontalAwayEvidenceMs = decay(horizontalAwayEvidenceMs, dt, 6f)
                }

                input.rawAway -> {
                    horizontalAwayEvidenceMs = (horizontalAwayEvidenceMs + dt)
                        .coerceAtMost(config.horizontalAwayTriggerMs + 3500f)
                    verticalAwayEvidenceMs = decay(verticalAwayEvidenceMs, dt, 6f)
                }

                else -> {
                    // Returning forward should clear a completed scan quickly so several
                    // ordinary mirror checks cannot add together into a false alarm.
                    horizontalAwayEvidenceMs = decay(horizontalAwayEvidenceMs, dt, 10f)
                    verticalAwayEvidenceMs = decay(verticalAwayEvidenceMs, dt, 10f)
                }
            }
        }

        val triggers = linkedSetOf<DriverTrigger>()
        if (eyeEvidenceMs >= config.eyeTriggerMs) triggers += DriverTrigger.EYES_CLOSED
        if (horizontalAwayEvidenceMs >= config.horizontalAwayTriggerMs) {
            triggers += DriverTrigger.HEAD_TURNED
        }
        if (verticalAwayEvidenceMs >= config.verticalAwayTriggerMs) {
            triggers += DriverTrigger.LOOKING_UP_DOWN
        }
        if (missingEvidenceMs >= config.missingTriggerMs) triggers += DriverTrigger.FACE_MISSING

        val activeAwayThreshold = if (input.pitchDominant) {
            config.verticalAwayTriggerMs
        } else {
            config.horizontalAwayTriggerMs
        }

        return PolicyDecision(
            triggers = triggers,
            eyeEvidenceMs = eyeEvidenceMs,
            awayEvidenceMs = max(horizontalAwayEvidenceMs, verticalAwayEvidenceMs),
            horizontalAwayEvidenceMs = horizontalAwayEvidenceMs,
            verticalAwayEvidenceMs = verticalAwayEvidenceMs,
            missingEvidenceMs = missingEvidenceMs,
            eyeTriggerMs = config.eyeTriggerMs,
            awayTriggerMs = activeAwayThreshold,
            missingTriggerMs = config.missingTriggerMs,
            rawEyesClosed = input.rawEyesClosed,
            rawAway = input.rawAway
        )
    }

    private fun decay(value: Float, dt: Float, multiplier: Float): Float =
        (value - dt * multiplier).coerceAtLeast(0f)
}
