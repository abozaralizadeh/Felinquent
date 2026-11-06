//! Prints what the sensors see, a few times, with timings. Used for spikes S-2, S-3 and S-6.
//! Run: cargo run --example probe -- [seconds]
//! An example, not a binary, so it stays out of the app bundle.
#[path = "../src/sensors/mod.rs"]
mod sensors;

use std::time::{Duration, Instant};

fn main() {
    let secs: u64 = std::env::args().nth(1).and_then(|s| s.parse().ok()).unwrap_or(3);
    let end = Instant::now() + Duration::from_secs(secs);
    let mut total = Duration::ZERO;
    let mut n = 0u32;
    while Instant::now() < end {
        let t = Instant::now();
        let w = sensors::windows("felinquent");
        let t_win = t.elapsed();
        let idle = sensors::idle_sec();
        let key = sensors::since_key_sec();
        let t1 = Instant::now();
        let mic = sensors::mic_in_use();
        let t_mic = t1.elapsed();
        let t2 = Instant::now();
        let cam = sensors::camera_in_use();
        let t_cam = t2.elapsed();
        let t3 = Instant::now();
        let space = sensors::space();
        let t_space = t3.elapsed();
        total += t.elapsed();
        if n == 3 {
            println!("timing: windows {:.2} ms, mic {:.2} ms, camera {:.2} ms, desktop {:.2} ms", t_win.as_secs_f64() * 1e3, t_mic.as_secs_f64() * 1e3, t_cam.as_secs_f64() * 1e3, t_space.as_secs_f64() * 1e3);
            println!("desktop: {space:?}");
        }
        n += 1;
        if n == 1 {
            for d in sensors::displays() {
                println!("display x={:.0} y={:.0} {:.0}x{:.0}", d.x, d.y, d.w, d.h);
            }
            println!("windows ({}):", w.len());
            for x in w.iter().take(8) {
                println!("  z{} {:<18} x={:.0} y={:.0} w={:.0} h={:.0}", x.z, x.app, x.x, x.y, x.w, x.h);
            }
            println!("idle={idle:.2}s since_key={key:.2}s mic_in_use={mic} camera_in_use={cam}");
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    println!("{} reads at 4 Hz, average {:.2} ms per full read", n, total.as_secs_f64() * 1000.0 / n as f64);
}
