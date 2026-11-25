//! Positional body primitives. These varints require minimal encodings.

use crate::engine::Result;

pub(super) fn invalid() -> String {
    "分享码的正文或物品列表无效或过大".into()
}

pub(super) fn put_uint(out: &mut Vec<u8>, number: usize) {
    put_u64(out, number as u64);
}

pub(super) fn put_u64(out: &mut Vec<u8>, mut number: u64) {
    while number >= 0x80 {
        out.push(number as u8 | 0x80);
        number >>= 7;
    }
    out.push(number as u8);
}

pub(super) struct Reader<'a>(pub(super) &'a [u8]);

impl<'a> Reader<'a> {
    pub(super) fn uint(&mut self) -> Result<usize> {
        u32::try_from(self.uint64()?)
            .map(|number| number as usize)
            .map_err(|_| invalid())
    }

    pub(super) fn uint64(&mut self) -> Result<u64> {
        let mut number = 0;
        for shift in (0..=63).step_by(7) {
            let byte = self.take(1)?[0];
            if shift == 63 && byte > 1 || shift > 0 && byte == 0 {
                return Err(invalid());
            }
            number |= u64::from(byte & 0x7f) << shift;
            if byte & 0x80 == 0 {
                return Ok(number);
            }
        }
        Err(invalid())
    }

    pub(super) fn offset(&mut self, start: usize) -> Result<usize> {
        start.checked_add(self.uint()?).ok_or_else(invalid)
    }

    pub(super) fn segment(&mut self) -> Result<&'a [u8]> {
        let length = self.uint()?;
        self.take(length)
    }

    pub(super) fn take(&mut self, length: usize) -> Result<&'a [u8]> {
        let (bytes, rest) = self.0.split_at_checked(length).ok_or_else(invalid)?;
        self.0 = rest;
        Ok(bytes)
    }

    pub(super) fn finish(self) -> Result<()> {
        if !self.0.is_empty() {
            return Err(invalid());
        }
        Ok(())
    }
}
