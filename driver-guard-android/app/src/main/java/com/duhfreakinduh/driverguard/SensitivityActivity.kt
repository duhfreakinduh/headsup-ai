package com.duhfreakinduh.driverguard

import android.graphics.Color
import android.os.Bundle
import android.text.InputType
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity

class SensitivityActivity : AppCompatActivity() {
    private lateinit var root: LinearLayout
    private var adultUnlocked = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#07111F"))
            isFillViewport = true
        }
        root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(16), dp(18), dp(16), dp(28))
        }
        scroll.addView(root, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setContentView(scroll)
        buildUi()
    }

    private fun buildUi() {
        root.removeAllViews()
        val teenLocked = TeenModeManager.isEnabled(this) && !adultUnlocked
        val current = DriverSensitivity.fromStorage(
            FeatureSettings.string(this, FeatureSettings.KEY_DRIVER_SENSITIVITY, DriverSensitivity.NORMAL.storageValue)
        )

        title("DRIVER GUARD AI", 12f, "#35E08A")
        title("Driver Sensitivity", 28f, "#FFFFFF")
        info(
            "Choose how long Driver Guard observes a signal before it becomes a distraction. " +
                "Horizontal mirror / blind-spot scans intentionally get more time than looking down. Changes apply on the next drive."
        )

        if (TeenModeManager.isEnabled(this)) {
            info(
                if (adultUnlocked) {
                    "Teen Mode is active. Adult controls are unlocked for this screen."
                } else {
                    "Teen Mode is active. Sensitivity is locked so the teen driver cannot make monitoring less strict."
                }
            )
            if (!adultUnlocked) {
                root.addView(Button(this).apply {
                    text = "UNLOCK WITH ADULT PIN"
                    setOnClickListener { showAdultUnlock() }
                })
            }
        }

        section("PROFILE")
        val radioGroup = RadioGroup(this).apply {
            orientation = RadioGroup.VERTICAL
        }
        DriverSensitivity.entries.forEach { mode ->
            radioGroup.addView(RadioButton(this).apply {
                id = ViewGroup.generateViewId()
                tag = mode.storageValue
                text = when (mode) {
                    DriverSensitivity.RELAXED -> "RELAXED — maximum grace for normal scanning"
                    DriverSensitivity.NORMAL -> "NORMAL — recommended balance"
                    DriverSensitivity.SENSITIVE -> "SENSITIVE — earlier warnings"
                    DriverSensitivity.CUSTOM -> "CUSTOM — choose your own timing"
                }
                setTextColor(Color.WHITE)
                isChecked = mode == current
                isEnabled = !teenLocked
            })
        }
        radioGroup.setOnCheckedChangeListener { group, checkedId ->
            if (teenLocked) return@setOnCheckedChangeListener
            val button = group.findViewById<RadioButton>(checkedId) ?: return@setOnCheckedChangeListener
            val mode = DriverSensitivity.fromStorage(button.tag?.toString().orEmpty())
            FeatureSettings.setString(this, FeatureSettings.KEY_DRIVER_SENSITIVITY, mode.storageValue)
            buildUi()
        }
        root.addView(radioGroup)

        section("WHAT THE PROFILES DO")
        profileLine("RELAXED", "Eyes 1.8s · side scan 7s · look up/down 5s · face missing 6s")
        profileLine("NORMAL", "Eyes 1.5s · side scan 5.5s · look up/down 3.5s · face missing 4.5s")
        profileLine("SENSITIVE", "Eyes 1.1s · side scan 3.8s · look up/down 2.8s · face missing 3.2s")

        if (current == DriverSensitivity.CUSTOM) {
            section("CUSTOM TIMING")
            val eyes = secondsField("Eyes closed seconds (0.8–3.0)", FeatureSettings.int(this, FeatureSettings.KEY_CUSTOM_EYES_MS, 1500))
            val mirror = secondsField("Mirror / blind-spot seconds (2.0–8.0)", FeatureSettings.int(this, FeatureSettings.KEY_CUSTOM_MIRROR_MS, 5500))
            val down = secondsField("Looking up/down seconds (1.5–8.0)", FeatureSettings.int(this, FeatureSettings.KEY_CUSTOM_LOOK_DOWN_MS, 3500))
            val missing = secondsField("Face missing seconds (2.0–8.0)", FeatureSettings.int(this, FeatureSettings.KEY_CUSTOM_MISSING_MS, 4500))

            root.addView(Button(this).apply {
                text = "SAVE CUSTOM TIMING"
                isEnabled = !teenLocked
                setOnClickListener {
                    val eyeMs = parseMs(eyes, 0.8, 3.0) ?: return@setOnClickListener
                    val mirrorMs = parseMs(mirror, 2.0, 8.0) ?: return@setOnClickListener
                    val downMs = parseMs(down, 1.5, 8.0) ?: return@setOnClickListener
                    val missingMs = parseMs(missing, 2.0, 8.0) ?: return@setOnClickListener
                    FeatureSettings.setInt(this@SensitivityActivity, FeatureSettings.KEY_CUSTOM_EYES_MS, eyeMs)
                    FeatureSettings.setInt(this@SensitivityActivity, FeatureSettings.KEY_CUSTOM_MIRROR_MS, mirrorMs)
                    FeatureSettings.setInt(this@SensitivityActivity, FeatureSettings.KEY_CUSTOM_LOOK_DOWN_MS, downMs)
                    FeatureSettings.setInt(this@SensitivityActivity, FeatureSettings.KEY_CUSTOM_MISSING_MS, missingMs)
                    Toast.makeText(this@SensitivityActivity, "Custom sensitivity saved for the next drive.", Toast.LENGTH_SHORT).show()
                    buildUi()
                }
            })
        }

        section("SAFE-DRIVING BEHAVIOR")
        info(
            "Driver Guard does not treat every head turn as dangerous. Side scans use their own evidence timer, " +
                "returning forward clears that evidence quickly, and side-profile turns suppress false eye-closed readings. " +
                "Smith Coach remains a separate optional feature."
        )

        root.addView(Button(this).apply {
            text = "BACK"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(18)
        })
    }

    private fun showAdultUnlock() {
        val pin = EditText(this).apply {
            hint = "Adult PIN"
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        AlertDialog.Builder(this)
            .setTitle("Unlock driver sensitivity")
            .setMessage("Teen Mode protects safety settings. Enter the adult PIN to make changes while parked.")
            .setView(pin)
            .setNegativeButton("Cancel", null)
            .setPositiveButton("Unlock") { _, _ ->
                if (TeenModeManager.verifyPin(this, pin.text.toString())) {
                    adultUnlocked = true
                    buildUi()
                } else {
                    Toast.makeText(this, "Incorrect adult PIN.", Toast.LENGTH_LONG).show()
                }
            }
            .show()
    }

    private fun secondsField(hintText: String, ms: Int): EditText {
        val field = EditText(this).apply {
            hint = hintText
            setHintTextColor(Color.parseColor("#8FA8C2"))
            setTextColor(Color.WHITE)
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText("%.1f".format(ms / 1000.0))
        }
        root.addView(field)
        return field
    }

    private fun parseMs(field: EditText, min: Double, max: Double): Int? {
        val seconds = field.text.toString().toDoubleOrNull()
        if (seconds == null || seconds < min || seconds > max) {
            Toast.makeText(this, "Enter a value from $min to $max seconds.", Toast.LENGTH_LONG).show()
            return null
        }
        return (seconds * 1000.0).toInt()
    }

    private fun profileLine(name: String, detail: String) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#142235"))
            setPadding(dp(12), dp(9), dp(12), dp(9))
        }
        box.addView(TextView(this).apply {
            text = name
            setTextColor(Color.WHITE)
            textSize = 15f
        })
        box.addView(TextView(this).apply {
            text = detail
            setTextColor(Color.parseColor("#8FA8C2"))
            textSize = 12f
        })
        root.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(6)
        })
    }

    private fun section(textValue: String) {
        root.addView(TextView(this).apply {
            text = textValue
            setTextColor(Color.parseColor("#5CB8FF"))
            textSize = 12f
            setPadding(0, dp(18), 0, dp(6))
        })
    }

    private fun title(textValue: String, size: Float, color: String) {
        root.addView(TextView(this).apply {
            text = textValue
            setTextColor(Color.parseColor(color))
            textSize = size
        })
    }

    private fun info(textValue: String) {
        root.addView(TextView(this).apply {
            text = textValue
            setTextColor(Color.WHITE)
            textSize = 13f
            setBackgroundColor(Color.parseColor("#24334A"))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(8)
            bottomMargin = dp(6)
        })
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
