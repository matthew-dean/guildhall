package main

import "testing"

func TestStatus(t *testing.T) {
	if status() != 200 {
		t.Fatal("bad status")
	}
}
