//! Browser bindings. Everything crosses the boundary as JSON strings so the TS side stays simple.
use wasm_bindgen::prelude::*;
use crate::*;

fn js<E: std::fmt::Display>(e: E) -> JsValue { JsValue::from_str(&e.to_string()) }
fn parse<T: serde::de::DeserializeOwned>(s: &str) -> Result<T, JsValue> { serde_json::from_str(s).map_err(js) }
fn point(s: &str) -> Result<RistrettoPoint, JsValue> { Ok(parse::<Pt>(&format!("\"{s}\""))?.0) }

#[wasm_bindgen] pub fn mp_keygen() -> String { let k = SecretKey::generate(); serde_json::json!({ "sk": k.to_hex(), "pk": k.public() }).to_string() }
#[wasm_bindgen] pub fn mp_joint_key(pks: &str) -> Result<String, JsValue> { let h = joint_key(&parse::<Vec<PublicKey>>(pks)?).map_err(js)?; Ok(hex::encode(h.compress().as_bytes())) }
#[wasm_bindgen] pub fn mp_open_deck() -> String { serde_json::to_string(&open_deck()).unwrap() }
#[wasm_bindgen] pub fn mp_shuffle(deck: &str, joint: &str) -> Result<String, JsValue> {
    let (out, proof) = shuffle(&parse::<Vec<Masked>>(deck)?, &point(joint)?);
    Ok(serde_json::json!({ "deck": out, "proof": proof }).to_string())
}
#[wasm_bindgen] pub fn mp_verify_shuffle(input: &str, output: &str, joint: &str, proof: &str) -> bool {
    (|| -> Result<(), JsValue> { verify_shuffle(&parse::<Vec<Masked>>(input)?, &parse::<Vec<Masked>>(output)?, &point(joint)?, &parse(proof)?).map_err(js) })().is_ok()
}
#[wasm_bindgen] pub fn mp_share(sk: &str, card: &str) -> Result<String, JsValue> { Ok(serde_json::to_string(&SecretKey::from_hex(sk).map_err(js)?.share(&parse(card)?)).unwrap()) }
#[wasm_bindgen] pub fn mp_verify_share(pk: &str, card: &str, share: &str) -> bool { (|| -> Result<(), JsValue> { verify_share(&parse(pk)?, &parse(card)?, &parse(share)?).map_err(js) })().is_ok() }
#[wasm_bindgen] pub fn mp_unmask(card: &str, shares: &str) -> Result<u32, JsValue> { Ok(unmask(&parse(card)?, &parse::<Vec<Share>>(shares)?).map_err(js)? as u32) }
