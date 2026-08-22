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
    fun sustainedClosedEyesTriggers() {
        val p = AttentionPolicy()
        p.update(PolicyInput(true, true, false), 0)
        p.update(PolicyInput(true, true, false), 100)
        p.update(PolicyInput(true, true, false), 200)
        val result = p.update(PolicyInput(true, true, false), 300)
        assertTrue(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun intermittentBadFramesStillAccumulateEvidence() {
        val p = AttentionPolicy()
        p.update(PolicyInput(true, true, false), 0)
        p.update(PolicyInput(true, true, false), 100)
        p.update(PolicyInput(true, false, false), 140)
        p.update(PolicyInput(true, true, false), 190)
        p.update(PolicyInput(true, true, false), 280)
        val result = p.update(PolicyInput(true, true, false), 370)
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
    fun recoveryDecaysEvidence() {
        val p = AttentionPolicy()
        p.update(PolicyInput(true, true, false), 0)
        p.update(PolicyInput(true, true, false), 120)
        p.update(PolicyInput(true, true, false), 240)
        var result = p.update(PolicyInput(true, false, false), 320)
        repeat(5) { i ->
            result = p.update(PolicyInput(true, false, false), 400L + i * 100L)
        }
        assertFalse(DriverTrigger.EYES_CLOSED in result.triggers)
    }
}
