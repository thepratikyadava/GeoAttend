import math
from typing import Any


MIN_CLASSROOM_SAMPLES = 3
MAX_CLASSROOM_SAMPLES = 5
DEFAULT_BACKGROUND_THRESHOLD = 0.65


def validate_signature_vector(signature: Any) -> list[float]:
    if not isinstance(signature, (list, tuple)) or len(signature) < 16 or len(signature) > 256:
        raise ValueError("Background signature must be a valid feature vector")

    normalized: list[float] = []
    for val in signature:
        num = float(val)
        if not math.isfinite(num):
            raise ValueError("Background signature contains non-finite values")
        normalized.append(num)
    return normalized


def validate_classroom_samples(samples: Any) -> list[dict[str, Any]]:
    if not isinstance(samples, list):
        raise ValueError("classroom_samples must be a list")

    if len(samples) < MIN_CLASSROOM_SAMPLES or len(samples) > MAX_CLASSROOM_SAMPLES:
        raise ValueError(
            f"Classroom samples must contain between {MIN_CLASSROOM_SAMPLES} and {MAX_CLASSROOM_SAMPLES} photos"
        )

    cleaned: list[dict[str, Any]] = []
    for idx, item in enumerate(samples):
        if not isinstance(item, dict):
            raise ValueError(f"Classroom sample #{idx + 1} must be an object")
        label = str(item.get("label") or f"Sample {idx + 1}").strip()[:80]
        sig = validate_signature_vector(item.get("signature"))
        cleaned.append({
            "label": label,
            "signature": sig
        })

    return cleaned


def cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    if len(vec_a) != len(vec_b) or not vec_a:
        return 0.0

    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = math.sqrt(sum(a * a for a in vec_a))
    norm_b = math.sqrt(sum(b * b for b in vec_b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0

    return round(dot / (norm_a * norm_b), 4)


def verify_classroom_background(
    classroom_samples: list[dict[str, Any]],
    live_signature: Any,
    threshold: float = DEFAULT_BACKGROUND_THRESHOLD
) -> dict[str, Any]:
    live_vec = validate_signature_vector(live_signature)

    best_sim = -1.0
    best_label = None
    for idx, sample in enumerate(classroom_samples):
        sample_vec = validate_signature_vector(sample.get("signature"))
        sim = cosine_similarity(sample_vec, live_vec)
        if sim > best_sim:
            best_sim = sim
            best_label = sample.get("label") or f"Sample {idx + 1}"

    return {
        "matched": best_sim >= threshold,
        "similarity": best_sim,
        "threshold": threshold,
        "matched_sample": best_label
    }
