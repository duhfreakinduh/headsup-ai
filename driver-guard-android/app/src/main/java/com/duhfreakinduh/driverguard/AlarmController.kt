package com.duhfreakinduh.driverguard

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.speech.tts.TextToSpeech
import java.util.Locale

class AlarmController(private val context: Context) : AutoCloseable, TextToSpeech.OnInitListener {
    private val handler = Handler(Looper.getMainLooper())
    private val tone = ToneGenerator(AudioManager.STREAM_ALARM, 100)
    private val tts = TextToSpeech(context, this)
    private var ttsReady = false
    private var alarming = false

    private val pulse = object : Runnable {
        override fun run() {
            if (!alarming) return
            if (FeatureSettings.enabled(context, FeatureSettings.KEY_ALARM_TONE, true)) {
                tone.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 720)
            }
            if (FeatureSettings.enabled(context, FeatureSettings.KEY_VIBRATION, true)) {
                vibrate(longArrayOf(0, 450, 90, 450))
            }
            handler.postDelayed(this, 920)
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            tts.language = Locale.US
            tts.setSpeechRate(1.08f)
            ttsReady = true
        }
    }

    fun warning(reason: DriverTrigger) {
        val message = when (reason) {
            DriverTrigger.EYES_CLOSED -> "Eyes open. Wake up."
            DriverTrigger.PHONE_VISIBLE -> "Put the phone down. Eyes on the road."
            DriverTrigger.FACE_MISSING -> "I cannot see you. Eyes on the road."
            else -> "Eyes on the road."
        }
        if (ttsReady && FeatureSettings.enabled(context, FeatureSettings.KEY_VOICE_WARNINGS, true)) {
            tts.stop()
            tts.speak(message, TextToSpeech.QUEUE_FLUSH, null, "driver-warning")
        }
        if (FeatureSettings.enabled(context, FeatureSettings.KEY_VIBRATION, true)) {
            vibrate(longArrayOf(0, 240, 90, 240))
        }
    }

    fun startAlarm() {
        if (alarming) return
        alarming = true
        handler.post(pulse)
    }

    fun stopAlarm() {
        alarming = false
        handler.removeCallbacks(pulse)
        tone.stopTone()
    }

    fun testAlarm() {
        warning(DriverTrigger.EYES_CLOSED)
        handler.postDelayed({
            if (FeatureSettings.enabled(context, FeatureSettings.KEY_ALARM_TONE, true)) {
                tone.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 850)
            }
            if (FeatureSettings.enabled(context, FeatureSettings.KEY_VIBRATION, true)) {
                vibrate(longArrayOf(0, 500, 100, 500))
            }
        }, 900)
    }

    private fun vibrate(pattern: LongArray) {
        val vibrator: Vibrator = if (Build.VERSION.SDK_INT >= 31) {
            context.getSystemService(VibratorManager::class.java).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
        }
        if (!vibrator.hasVibrator()) return
        if (Build.VERSION.SDK_INT >= 26) {
            vibrator.vibrate(VibrationEffect.createWaveform(pattern, -1))
        } else {
            @Suppress("DEPRECATION")
            vibrator.vibrate(pattern, -1)
        }
    }

    override fun close() {
        stopAlarm()
        tts.stop()
        tts.shutdown()
        tone.release()
    }
}
