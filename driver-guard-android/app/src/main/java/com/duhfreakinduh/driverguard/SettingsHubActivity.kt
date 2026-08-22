package com.duhfreakinduh.driverguard

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class SettingsHubActivity : AppCompatActivity() {
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
        })
        root.addView(TextView(this).apply {
            text = "Configure Driver Guard while parked. Core monitoring remains enabled; optional features and sensitivity are managed separately."
            setTextColor(Color.WHITE)
            textSize = 13f
            setBackgroundColor(Color.parseColor("#24334A"))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(10)
            bottomMargin = dp(12)
        })

        addButton(
            root,
            "DRIVER SENSITIVITY",
            "Relaxed / Normal / Sensitive / Custom timing for eyes, mirror scans, looking down and face missing."
        ) {
            startActivity(Intent(this, SensitivityActivity::class.java))
        }

        addButton(
            root,
            "FEATURES + TEEN MODE",
            "Phone detection, Smith Coach, Rear Road Guard, alerts, adult PIN and parent notifications."
        ) {
            startActivity(Intent(this, SettingsActivity::class.java))
        }

        root.addView(Button(this).apply {
            text = "BACK TO DRIVER GUARD"
            setOnClickListener { finish() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(18)
        })

        setContentView(scroll)
    }

    private fun addButton(root: LinearLayout, title: String, detail: String, onClick: () -> Unit) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#142235"))
            setPadding(dp(12), dp(10), dp(12), dp(10))
        }
        box.addView(Button(this).apply {
            text = title
            setOnClickListener { onClick() }
        })
        box.addView(TextView(this).apply {
            text = detail
            setTextColor(Color.parseColor("#8FA8C2"))
            textSize = 12f
        })
        root.addView(box, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            bottomMargin = dp(10)
        })
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
