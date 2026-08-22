package com.duhfreakinduh.driverguard

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AttentionPolicyTest {
    @Test
    fun quickBlinkDoesNotTrigger() {
        val p = AttentionPolicy()
        p.update(PolicyInput(true, true, false), 0)
        p.update(PolicyInput(true, true, false), 120)
        val result = p.update(PolicyInput(true, false, false), 180)
        assertFalse(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun longBlinkUnderSevenTenthsDoesNotTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, true, false), 0)
        for (time in 100L..600L step 100L) {
            result = p.update(PolicyInput(true, true, false), time)
        }
        assertFalse(DriverTrigger.EYES_CLOSED in result.triggers)
        result = p.update(PolicyInput(true, false, false), 700)
        assertFalse(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun sustainedClosedEyesTriggers() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, true, false), 0)
        for (time in 100L..800L step 100L) {
            result = p.update(PolicyInput(true, true, false), time)
        }
        assertTrue(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun intermittentBadFramesStillAccumulateEvidence() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, true, false), 0)
        val samples = listOf(
            100L to true,
            200L to true,
            260L to false,
            340L to true,
            440L to true,
            540L to true,
            640L to true,
            740L to true,
            840L to true,
            940L to true,
            1040L to true
        )
        for ((time, closed) in samples) {
            result = p.update(PolicyInput(true, closed, false), time)
        }
        assertTrue(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun headTurnTriggers() {
        val p = AttentionPolicy()
        p.update(PolicyInput(true, false, true), 0)
        p.update(PolicyInput(true, false, true), 120)
        p.update(PolicyInput(true, false, true), 240)
        val result = p.update(PolicyInput(true, false, true), 360)
        assertTrue(DriverTrigger.HEAD_TURNED in result.triggers)
    }

    @Test
    fun pitchDominantUsesLookingUpDownReason() {
        val p = AttentionPolicy()
        p.update(PolicyInput(true, false, true, true), 0)
        p.update(PolicyInput(true, false, true, true), 120)
        p.update(PolicyInput(true, false, true, true), 240)
        val result = p.update(PolicyInput(true, false, true, true), 360)
        assertTrue(DriverTrigger.LOOKING_UP_DOWN in result.triggers)
    }

    @Test
    fun missingFaceTriggers() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(false, false, false), 0)
        for (time in 100L..800L step 100L) {
            result = p.update(PolicyInput(false, false, false), time)
        }
        assertTrue(DriverTrigger.FACE_MISSING in result.triggers)
    }

    @Test
    fun recoveryDecaysEyeEvidenceQuickly() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, true, false), 0)
        for (time in 100L..800L step 100L) {
            result = p.update(PolicyInput(true, true, false), time)
        }
        assertTrue(DriverTrigger.EYES_CLOSED in result.triggers)
        result = p.update(PolicyInput(true, false, false), 900)
        result = p.update(PolicyInput(true, false, false), 1000)
        assertFalse(DriverTrigger.EYES_CLOSED in result.triggers)
    }
}
