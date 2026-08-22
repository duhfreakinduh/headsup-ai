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
    fun normalModeOnePointThreeSecondEyeClosureDoesNotTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, true, false), 0)
        for (time in 100L..1300L step 100L) {
            result = p.update(PolicyInput(true, true, false), time)
        }
        assertFalse(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun normalModeSustainedClosedEyesEventuallyTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, true, false), 0)
        for (time in 100L..1700L step 100L) {
            result = p.update(PolicyInput(true, true, false), time)
        }
        assertTrue(DriverTrigger.EYES_CLOSED in result.triggers)
    }

    @Test
    fun normalModeThreeSecondMirrorGlanceDoesNotTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true), 0)
        for (time in 100L..3000L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
    }

    @Test
    fun normalModeFiveSecondMirrorOrBlindSpotScanDoesNotTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true), 0)
        for (time in 100L..5000L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
    }

    @Test
    fun normalModeSustainedSideDistractionEventuallyTriggers() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true), 0)
        for (time in 100L..5900L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertTrue(DriverTrigger.HEAD_TURNED in result.triggers)
    }

    @Test
    fun normalModeLookingDownUsesShorterIndependentTimer() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true, true), 0)
        for (time in 100L..3200L step 100L) {
            result = p.update(PolicyInput(true, false, true, true), time)
        }
        assertFalse(DriverTrigger.LOOKING_UP_DOWN in result.triggers)
        for (time in 3300L..3800L step 100L) {
            result = p.update(PolicyInput(true, false, true, true), time)
        }
        assertTrue(DriverTrigger.LOOKING_UP_DOWN in result.triggers)
    }

    @Test
    fun mirrorEvidenceDoesNotPreloadLookDownTimer() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true, false), 0)
        for (time in 100L..4000L step 100L) {
            result = p.update(PolicyInput(true, false, true, false), time)
        }
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)

        for (time in 4100L..5000L step 100L) {
            result = p.update(PolicyInput(true, false, true, true), time)
        }
        assertFalse(DriverTrigger.LOOKING_UP_DOWN in result.triggers)
    }

    @Test
    fun normalModeFourSecondFaceLossDoesNotTrigger() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(false, false, false), 0)
        for (time in 100L..4000L step 100L) {
            result = p.update(PolicyInput(false, false, false), time)
        }
        assertFalse(DriverTrigger.FACE_MISSING in result.triggers)
    }

    @Test
    fun normalModeSustainedFaceLossEventuallyTriggers() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(false, false, false), 0)
        for (time in 100L..4900L step 100L) {
            result = p.update(PolicyInput(false, false, false), time)
        }
        assertTrue(DriverTrigger.FACE_MISSING in result.triggers)
    }

    @Test
    fun returningForwardClearsMirrorEvidenceFast() {
        val p = AttentionPolicy()
        var result = p.update(PolicyInput(true, false, true), 0)
        for (time in 100L..4500L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
        for (time in 4600L..5000L step 100L) {
            result = p.update(PolicyInput(true, false, false), time)
        }
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
        assertTrue(result.horizontalAwayEvidenceMs < 700f)
    }

    @Test
    fun relaxedModeAllowsSixSecondSideScan() {
        val p = AttentionPolicy(
            AttentionConfig(
                DriverSensitivity.RELAXED,
                1800f,
                7000f,
                5000f,
                6000f,
                0.19f,
                0.25f,
                0.15f
            )
        )
        var result = p.update(PolicyInput(true, false, true), 0)
        for (time in 100L..6000L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
        for (time in 6100L..7300L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertTrue(DriverTrigger.HEAD_TURNED in result.triggers)
    }

    @Test
    fun sensitiveModeStillRequiresSustainedSideDistraction() {
        val p = AttentionPolicy(
            AttentionConfig(
                DriverSensitivity.SENSITIVE,
                1100f,
                3800f,
                2800f,
                3200f,
                0.14f,
                0.18f,
                0.12f
            )
        )
        var result = p.update(PolicyInput(true, false, true), 0)
        for (time in 100L..3400L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
        for (time in 3500L..4100L step 100L) {
            result = p.update(PolicyInput(true, false, true), time)
        }
        assertTrue(DriverTrigger.HEAD_TURNED in result.triggers)
    }

    @Test
    fun largeFrameGapIsCappedAndDoesNotInstantlyTrigger() {
        val p = AttentionPolicy()
        p.update(PolicyInput(true, false, true), 0)
        val result = p.update(PolicyInput(true, false, true), 20_000)
        assertFalse(DriverTrigger.HEAD_TURNED in result.triggers)
        assertTrue(result.horizontalAwayEvidenceMs < 500f)
    }
}
