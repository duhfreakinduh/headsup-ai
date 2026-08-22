package com.duhfreakinduh.driverguard

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
    val missingEvidenceMs: Float,
    val rawEyesClosed: Boolean,
    val rawAway: Boolean
)

class AttentionPolicy {
    private var lastTimestampMs: Long? = null
    private var eyeEvidenceMs = 0f
    private var awayEvidenceMs = 0f
    private var missingEvidenceMs = 0f

    fun reset() {
        lastTimestampMs = null
        eyeEvidenceMs = 0f
        awayEvidenceMs = 0f
        missingEvidenceMs = 0f
    }

    fun update(input: PolicyInput, timestampMs: Long): PolicyDecision {
        val dt = lastTimestampMs?.let { (timestampMs - it).coerceIn(16L, 150L).toFloat() } ?: 65f
        lastTimestampMs = timestampMs

        if (!input.hasFace) {
            missingEvidenceMs = (missingEvidenceMs + dt).coerceAtMost(3000f)
            eyeEvidenceMs = (eyeEvidenceMs - dt * 3.5f).coerceAtLeast(0f)
            awayEvidenceMs = (awayEvidenceMs - dt * 3f).coerceAtLeast(0f)
        } else {
            missingEvidenceMs = (missingEvidenceMs - dt * 4f).coerceAtLeast(0f)
            eyeEvidenceMs = if (input.rawEyesClosed) {
                (eyeEvidenceMs + dt).coerceAtMost(1200f)
            } else {
                (eyeEvidenceMs - dt * 2.8f).coerceAtLeast(0f)
            }
            awayEvidenceMs = if (input.rawAway) {
                (awayEvidenceMs + dt).coerceAtMost(1800f)
            } else {
                (awayEvidenceMs - dt * 2.2f).coerceAtLeast(0f)
            }
        }

        val triggers = linkedSetOf<DriverTrigger>()
        if (eyeEvidenceMs >= 220f) triggers += DriverTrigger.EYES_CLOSED
        if (awayEvidenceMs >= 300f) {
            triggers += if (input.pitchDominant) DriverTrigger.LOOKING_UP_DOWN else DriverTrigger.HEAD_TURNED
        }
        if (missingEvidenceMs >= 700f) triggers += DriverTrigger.FACE_MISSING

        return PolicyDecision(
            triggers = triggers,
            eyeEvidenceMs = eyeEvidenceMs,
            awayEvidenceMs = awayEvidenceMs,
            missingEvidenceMs = missingEvidenceMs,
            rawEyesClosed = input.rawEyesClosed,
            rawAway = input.rawAway
        )
    }
}
