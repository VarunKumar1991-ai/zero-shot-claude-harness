from auth.password import hash_password, verify_password


def test_hash_and_verify_roundtrip():
    hashed = hash_password("Demo@Pass123")
    assert hashed != "Demo@Pass123"
    assert verify_password("Demo@Pass123", hashed) is True


def test_verify_wrong_password_fails():
    hashed = hash_password("Demo@Pass123")
    assert verify_password("WrongPassword", hashed) is False


def test_verify_malformed_hash_returns_false_not_raise():
    assert verify_password("anything", "not-a-real-bcrypt-hash") is False
