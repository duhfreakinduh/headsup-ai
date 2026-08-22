package com.duhfreakinduh.driverguard

data class SmithCoachState(
    val message: String,
    val scanCount: Int,
    val needsScan: Boolean,
    val prolongedLook: Boolean
)

class SmithCoach {
    private var lastScanMs = 0L
    private var awayStartedMs: Long? = null
    private var awayBecameTrigger = false
    private var scanCount = 0

    fun reset(nowMs: Long) {
        lastScanMs = nowMs
        awayStartedMs = null
        awayBecameTrigger = false
        scanCount = 0
    }

    fun update(rawAway: Boolean, hasAttentionTrigger: Boolean, nowMs: Long): SmithCoachState {
        if (lastScanMs == 0L) reset(nowMs)

        if (rawAway) {
            if (awayStartedMs == null) {
                awayStartedMs = nowMs
                awayBecameTrigger = false
            }
            if (hasAttentionTrigger) awayBecameTrigger = true
        } else if (awayStartedMs != null) {
            val duration = nowMs - (awayStartedMs ?: nowMs)
            if (!awayBecameTrigger && duration in 200L..2500L) {
                lastScanMs = nowMs
                scanCount += 1
            }
            awayStartedMs = null
            awayBecameTrigger = false
        }

        val activeAwayMs = awayStartedMs?.let { nowMs - it } ?: 0L
        val sinceScan = (nowMs - lastScanMs).coerceAtLeast(0L)
        val prolonged = rawAway && activeAwayMs > 2000L
        val needsScan = !rawAway && sinceScan > 9000L

        val message = when {
            prolonged -> "RETURN FORWARD · keep eyes moving"
            needsScan -> "SCAN MIRRORS · get the big picture"
            rawAway -> "SCANNING · brief mirror/window check"
            else -> "BIG PICTURE OK · last scan ${sinceScan / 1000}s ago"
        }

        return SmithCoachState(
            message = message,
            scanCount = scanCount,
            needsScan = needsScan,
            prolongedLook = prolonged
        )
    }
}
