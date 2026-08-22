package com.duhfreakinduh.driverguard

import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat

class SettingsActivity : AppCompatActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#07111F"))
            isFillViewport = true
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(18), dp(16), dp(28))
        }
        scroll.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))

        root.addView(TextView(this).apply {
            text = "DRIVER GUARD AI"
            setTextColor(Color.parseColor("#35E08A"))
            textSize = 12f
        })
        root.addView(TextView(this).apply {
            text = "Settings"
            setTextColor(Color.WHITE)
            textSize = 28f
            setPadding(0, dp(2), 0, dp(10))
        })
        root.addView(TextView(this).apply {
            text = "Core face / eye / head monitoring is not changed here. These switches only control optional features. Set up settings while parked."
            setTextColor(Color.WHITE)
            textSize = 13f
            setBackgroundColor(Color.parseColor("#24334A"))
            setPadding(dp(12), dp(12), dp(12), dp(12))
        })

        section(root, "CORE PROTECTION")
        addLockedSwitch(
            root,
            "Core driver monitoring",
            "Always ON. Face, eyes and head-attention detection remain part of the core app."
        )

        section(root, "CURRENT OPTIONAL FEATURES")
        addSettingSwitch(
            root,
            "Visible phone detection",
            "Run the Hugging Face YOLOS phone detector.",
            FeatureSettings.KEY_PHONE_DETECTION,
            true
        )
        addSettingSwitch(
            root,
            "Spoken warnings",
            "Voice prompts such as Eyes on the road.",
            FeatureSettings.KEY_VOICE_WARNINGS,
            true
        )
        addSettingSwitch(
            root,
            "Vibration",
            "Vibrate on warnings and alarms.",
            FeatureSettings.KEY_VIBRATION,
            true
        )
        addSettingSwitch(
            root,
            "Loud alarm tone",
            "Play the repeating alarm tone after a sustained trigger.",
            FeatureSettings.KEY_ALARM_TONE,
            true
        )

        section(root, "NEXT FEATURE FLAGS")
        root.addView(TextView(this).apply {
            text = "These switches are stored now so the Smith / rear-camera build can use them independently. They do not alter the current detector until those features are added."
            setTextColor(Color.parseColor("#8FA8C2"))
            textSize = 12f
            setPadding(0, 0, 0, dp(6))
        })
        addSettingSwitch(
            root,
            "Smith driving coach",
            "Optional coaching based on Smith-style scanning, space and escape-route habits.",
            FeatureSettings.KEY_SMITH_COACH,
            false
        )
        addSettingSwitch(
            root,
            "Rear Road Guard",
            "Optional rear-camera road monitoring when the dual-camera feature is installed.",
            FeatureSettings.KEY_REAR_ROAD_GUARD,
            false
        )
        addSettingSwitch(
            root,
            "Road hazard alerts",
            "Optional in-lane vehicle / pedestrian / obstacle alerts from Road Guard.",
            FeatureSettings.KEY_ROAD_HAZARDS,
            false
        )

        root.addView(Button(this).apply {
            text = "BACK TO DRIVER GUARD"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(18)
        })

        setContentView(scroll)
    }

    private fun section(root: LinearLayout, title: String) {
        root.addView(TextView(this).apply {
            text = title
            setTextColor(Color.parseColor("#5CB8FF"))
            textSize = 12f
            setPadding(0, dp(18), 0, dp(6))
        })
    }

    private fun addLockedSwitch(root: LinearLayout, title: String, description: String) {
        val box = settingBox(root)
        box.addView(SwitchCompat(this).apply {
            text = title
            setTextColor(Color.WHITE)
            textSize = 16f
            isChecked = true
            isEnabled = false
        })
        box.addView(description(description))
    }

    private fun addSettingSwitch(
        root: LinearLayout,
        title: String,
        description: String,
        key: String,
        defaultValue: Boolean
    ) {
        val box = settingBox(root)
        box.addView(SwitchCompat(this).apply {
            text = title
            setTextColor(Color.WHITE)
            textSize = 16f
            isChecked = FeatureSettings.enabled(this@SettingsActivity, key, defaultValue)
            setOnCheckedChangeListener { _, enabled ->
                FeatureSettings.setEnabled(this@SettingsActivity, key, enabled)
            }
        })
        box.addView(description(description))
    }

    private fun settingBox(root: LinearLayout): LinearLayout {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#142235"))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        root.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(8)
        })
        return box
    }

    private fun description(textValue: String) = TextView(this).apply {
        text = textValue
        setTextColor(Color.parseColor("#8FA8C2"))
        textSize = 12f
        setPadding(0, dp(4), 0, 0)
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
